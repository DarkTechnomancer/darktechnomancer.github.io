/*
Welcome to the first part of the commented code examples. This is a supplement to the guide, but I'll be
writing the comments in such a way that you could follow them as a sort of tutorial. I'll try to explain
how and why I do things as I go.

This first chapter is just for making a single batch of parallel tasks, and while it might seem like a lot of stuff
just to do something so simple, I've done a lot of groundwork here that will hopefully make things more simple as
we scale up the program to a more complex batcher.

Remember to change the filepaths if you copy these scripts to remove "/part1/". (You'll need to do utils.js too)
*/

/*
For the sake of tidiness, I've put some of the generic functions into a function library. Some of these
functions can be used by other scripts and programs, and aren't limited to just being used by the batcher.
*/
import { getServers, copyScripts, checkTarget, isPrepped, prep } from "/part1/utils.js";

// Various global constants to help us keep track of things like filepaths.
// The use of common keys in simple objects allows us to quickly reference these constants while iterating over TYPES.
const TYPES = ["hack", "weaken1", "grow", "weaken2"];
const WORKERS = ["/part1/tHack.js", "/part1/tWeaken.js", "/part1/tGrow.js"];
const SCRIPTS = { hack: "/part1/tHack.js", weaken1: "/part1/tWeaken.js", grow: "/part1/tGrow.js", weaken2: "/part1/tWeaken.js" };
const COSTS = { hack: 1.7, weaken1: 1.75, grow: 1.75, weaken2: 1.75 };
const OFFSETS = { hack: 0, weaken1: 1, grow: 2, weaken2: 3 };

/*
Normally it's my preference to put the main function at the top, but it will be easier if I describe the classes
first. If you're unfamiliar with classes, they are essentially just objects with predefined behaviors. By strictly defining
what each object is, it will help us keep track of what our program is doing.
*/

// First a job. Essentially, this is just a big pile of information about one H/G/W task that we intend to run.
class Job {
	//A class constructer is a function that is called when a new class object is created.
	// The "this" object refers to the specific class instance calling the function.
	constructor(type, metrics, server = "none") {
		this.type = type; // Hack, Weaken1, Grow, or Weaken2
		this.end = metrics.ends[type]; // The exact date/time we intend the job to finish
		this.time = metrics.times[type]; // How long the job should take to execute
		this.target = metrics.target; // The server we're hacking
		this.threads = metrics.threads[type]; // The number of threads to run the script with
		this.cost = this.threads * COSTS[type]; // The amount of RAM the script will cost
		this.server = server; // The server the script is running on
		this.report = false; // Whether the script should communicate back when it's finished--you can ignore this for now.
		this.port = metrics.port; // We're not using ports yet, so you can ignore this.
		this.batch = 0; // The batch number. We're just doing the one for now, so again this is irrelevant.
	}
}

// This is a class that holds all the information we need to know about the server we're hacking.
// Most of it is self-explanatory, but I'll comment a few specific bits.
/** @param {NS} ns */
class Metrics {
	constructor(ns, server) {
		this.target = server;
		this.maxMoney = ns.getServerMaxMoney(server);
		this.money = Math.max(ns.getServerMoneyAvailable(server), 1);
		this.minSec = ns.getServerMinSecurityLevel(server);
		this.sec = ns.getServerSecurityLevel(server);
		this.prepped = isPrepped(ns, server);
		this.chance = 0; // Hack chance is mainly used to estimate expected returns. Not used in this part.
		this.wTime = 0; // Weaken time is stored separately from the others for convenience, since it's used often.
		this.delay = 0; // Not used in this part. The cumulative delays caused by late jobs.
		this.spacer = 5; // The number of milliseconds between each job finishing.
		this.greed = 0.1; // The portion of money we're hacking from the server. This is actually calculated by function later.
		this.depth = 0; // Not used in this part. The number of concurrent batches to run simultaneously.

		// These objects use the same common keys as the constants. Used to set up jobs.
		this.times = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };
		this.ends = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };
		this.threads = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };

		this.port = ns.pid; // We're not using ports yet, so you can ignore this.
	}

	// This function calculates the current metrics of the server. For now, we only run it once, but later
	// we can use it any time we expect the environment to change, such as after a level up, or if we switch targets.
	calculate(ns, greed = this.greed) {
		const server = this.target;
		const maxMoney = this.maxMoney;
		this.money = ns.getServerMoneyAvailable(server);
		this.sec = ns.getServerSecurityLevel(server);
		this.wTime = ns.getWeakenTime(server);
		this.times.weaken1 = this.wTime;
		this.times.weaken2 = this.wTime;
		this.times.hack = this.wTime / 4;
		this.times.grow = this.wTime * 0.8;
		this.depth = this.wTime / this.spacer * 4;

		const hPercent = ns.hackAnalyze(server);
		const amount = maxMoney * greed;
		const hThreads = Math.max(Math.floor(ns.hackAnalyzeThreads(server, amount)), 1);
		const tGreed = hPercent * hThreads;
		const gThreads = Math.ceil(ns.growthAnalyze(server, maxMoney / (maxMoney - maxMoney * tGreed)));
		this.threads.weaken1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		this.threads.weaken2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);
		this.threads.hack = hThreads;
		this.threads.grow = gThreads;
		this.chance = ns.hackAnalyzeChance(server);
	}
}

/*
This is probably the most involved class so far. It keeps track of all the ram available on the network and handles
the allocation of that ram. Later, when we're running tons of scripts and constantly resolving and deploying jobs in
a steady loop, this will be extremely important to keep things running smoothly and quickly.
*/
/** @param {NS} ns */
class RamNet {
	// These fields are all private. It's easy to mess things up when handling the ram allocation, so we want to
	// limit the interaction with the class's data only to designated functions of the class itself.
	#blocks = []; // A list of every server and how much ram it has available.
	#minBlockSize = Infinity; // The size of the smallest block on the network (spoilers, it usually 4).
	#maxBlockSize = 0; // The size of the largest block on the network.
	#totalRam = 0; // The total ram available on the network.
	#maxRam = 0; // The maximum ram that the network can support.
	#index = new Map(); // An index for accessing memory blocks by server. More on this later.

	// We feed the RamNet a list of servers to turn into useful data.
	constructor(ns, servers) {
		for (const server of servers) {
			if (ns.hasRootAccess(server)) {
				const maxRam = ns.getServerMaxRam(server);
				const ram = maxRam - ns.getServerUsedRam(server);
				if (ram >= 1.60) { // Make sure there's enough ram on the server to run at least one script.
					// A block is just a server hostname, and the amount of available ram on it.
					// However, it's very easy to extend the functionality by adding new values as needed.
					const block = { server: server, ram: ram };
					this.#blocks.push(block);
					if (ram < this.#minBlockSize) this.#minBlockSize = ram;
					if (ram > this.#maxBlockSize) this.#maxBlockSize = ram;
					this.#totalRam += ram;
					this.#maxRam += maxRam;
				}
			}
		}
		// We have our own special sorting function, coming up in a moment.
		this.#sort();

		// Here we make our index map by matching server names to their corresponding index in the blocks array.
		// This will let us look up specific blocks with another function later.
		this.#blocks.forEach((block, index) => this.#index.set(block.server, index));
	}

	// Custom sort algorithm. You can play around with this to make your own system of prioritization.
	// For now, I just go smallest to largest, with home last.
	#sort() {
		this.#blocks.sort((x, y) => {
			// Prefer assigning to home last so that we have more room to play the game while batching.
			if (x.server === "home") return 1;
			if (y.server === "home") return -1;

			return x.ram - y.ram;
		});
	}

	// Here's that function for looking up a memory block by server name.
	getBlock(server) {
		if (this.#index.has(server)) {
			return this.#blocks[this.#index.get(server)];
		} else {
			throw new Error(`Server ${server} not found in RamNet.`);
		}
	}

	/*
	Getter functions for our private fields. This might seem redundant, but we don't want to expose the data
	to being overwritten unintentionally.
	*/
	get totalRam() {
		return this.#totalRam;
	}

	get maxRam() {
		return this.#maxRam;
	}

	get maxBlockSize() {
		return this.#maxBlockSize;
	}

	// When assigning a job, we find a block that can fit it and set its server to that block.
	// Then we reduce the available ram to reserve it for that job.
	assign(job) {
		const block = this.#blocks.find(block => block.ram >= job.cost);
		if (block) {
			job.server = block.server;
			block.ram -= job.cost;
			this.#totalRam -= job.cost;
			return true;
		} else return false; // Return false if we don't find one.
	}

	// When a job finishes, we can use the index lookup, since it's much faster.
	// We don't actually use this yet, but it will come in handy later.
	finish(job) {
		const block = this.getBlock(job.server);
		block.ram += job.cost;
		this.#totalRam += job.cost;
	}

	// This gets us make a copy of the blocks so that we can calculate without changing any data.
	cloneBlocks() {
		return this.#blocks.map(block => ({ ...block }));
	}

	// This is just a debugging tool
	printBlocks(ns) {
		for (const block of this.#blocks) ns.tprint(block);
	}
}

// If you're not familiar, params just help the interpreter tell what sort of objects specific variables are supposed to be.
// This function lets us calculate the strongest batch we can muster against a target.
/**
 * @param {NS} ns
 * @param {Metrics} metrics
 * @param {RamNet} ramNet
 */
export function optimizeBatch(ns, metrics, ramNet) {
	// Some constants that we'll use later. You can adjust some of these if you want to speed things up.
	const maxThreads = ramNet.maxBlockSize / 1.75;
	const maxMoney = metrics.maxMoney;
	const hPercent = ns.hackAnalyze(metrics.target);

	// We start at 99% greed and check all the way down to 0.1%, adjusting by 0.1% until we find something that fits.
	// This is a brute force algorithm and very computationally expensive. You don't want to be running it too often.
	const minGreed = 0.001;
	const stepValue = 0.001;
	let greed = 0.99;
	while (greed > minGreed) {
		// Standard calculations for threads. This is almost exactly the same as the Metrics.calculate() function.
		const amount = maxMoney * greed;
		const hThreads = Math.max(Math.floor(ns.hackAnalyzeThreads(metrics.target, amount)), 1);
		const tGreed = hPercent * hThreads;
		const gThreads = Math.ceil(ns.growthAnalyze(metrics.target, maxMoney / (maxMoney - maxMoney * tGreed)));

		// If our network's biggest server can't fit the hack or grow threads, greed is too high.
		if (Math.max(hThreads, gThreads) <= maxThreads) {
			const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
			const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);

			// If we aren't iterating through the TYPES constant, we can just use literals for cost.
			const threadCosts = [hThreads * 1.7, wThreads1 * 1.75, gThreads * 1.75, wThreads2 * 1.75];

			// Make a copy of the ramNet and try assigning threads.
			const pRam = ramNet.cloneBlocks();
			let found;
			for (const cost of threadCosts) {
				found = false;
				for (const block of pRam) {
					if (block.ram < cost) continue;
					found = true;
					block.ram -= cost;
					break;
				}
				if (found) continue;
				// If we're ever unable to assign one of the jobs, we break and try again.
				break;
			}
			// If we managed to assign them all, great! Set the corresponding values in metrics and report our success.
			if (found) {
				metrics.greed = greed;
				metrics.threads = { hack: hThreads, weaken1: wThreads1, grow: gThreads, weaken2: wThreads2 };
				return true;
			}
		}
		// If we got this far, it means we didn't find anything, so we try again.
		greed -= stepValue;
	}
	// If we got *this* far, something has gone horribly wrong.
	throw new Error("Not enough ram to run even a single batch. Something has gone seriously wrong.");
}

// The main function at last. With all the functionality defined above, this is actually going to be quite lean.
/** @param {NS} ns */
export async function main(ns) {
	// Good ol' trusty n00dles will be our default target.
	// If you want to test on a specific server, you can edit the target and comment out the checkTarget function.
	let target = "n00dles";

	/*
	This is a handy function that finds all the servers on the network. I've designed it so that you can
	plug module functions into the lambda to handle multiple tasks while going through the server list.
	In this case, I'm finding the best target, copying scripts onto the servers, and also building a list of owned servers.
	*/
	const servers = getServers(ns, (server) => {
		// Don't worry if you don't have Formulas, it's not needed at all here.
		target = checkTarget(ns, server, target, ns.fileExists("Formulas.exe", "home"));
		copyScripts(ns, server, WORKERS, true);
		return ns.hasRootAccess(server);
	});

	// As nice as it would be to not have to iterate over the servers a second time, RamNet requires it.
	const ramNet = new RamNet(ns, servers);
	const metrics = new Metrics(ns, target);

	// Prep the server if it's not prepped. You can see the details in utils.js
	if (!isPrepped(ns, target)) await prep(ns, metrics, ramNet);
	optimizeBatch(ns, metrics, ramNet);
	metrics.calculate(ns);

	/*
	At last, time to actually do the thing! With everything handled by our classes, it's pretty simple.
	We start going through each type, making a new job for that type, then adding it to an array that represents our batch
	and assigning it some ram.
	*/
	const batch = [];
	for (const type of TYPES) {
		// The offset measures the order jobs should end in. The +100 is just a buffer so jobs don't start late.
		metrics.ends[type] = Date.now() + metrics.wTime + metrics.spacer * OFFSETS[type] + 100;
		const job = new Job(type, metrics);
		if (!ramNet.assign(job)) {
			ns.tprint(`ERROR: Unable to assign ${type}. Dumping debug info:`);
			ns.tprint(job);
			ns.tprint(metrics);
			ramNet.printBlocks(ns);
			return;
		}
		batch.push(job);
	}

	// Then we just deploy each of them. The only argument the workers get is a serialized version of the Job object.
	// Workers themselves will parse the JSON and use that data for their own calculations. See the worker scripts for details.
	for (const job of batch) {
		ns.exec(SCRIPTS[job.type], job.server, job.threads, JSON.stringify(job));
	}

	// This is just some fancy UI stuff to give you feedback when you run the script.
	const timer = setInterval(() => {
		ns.ui.clearTerminal();
		ns.tprint(`Hacking \$${ns.formatNumber(metrics.maxMoney * metrics.greed)} from ${metrics.target}`)
		ns.tprint(`Running batch: ETA ${ns.tFormat(metrics.ends.weaken2 - Date.now())}`);
	}, 1000);

	// If you're using intervals and timeouts, make sure you have a line like this to remove them if the script is killed.
	// Otherwise they will continue to run in the background forever (they are global to the entire game, not just the script.)
	ns.atExit(() => clearInterval(timer));
	await ns.asleep(metrics.wTime);
	clearInterval(timer);
	ns.tprint(`Done!`)
}