/*
Welcome to part 3. I'll only be commenting on things that have changed from the previous parts, so if there's something
confusing, be sure to go back and look at parts 1 and 2 for more detailed explanations.

This time we're going to make a shotgun batcher. In some ways this is really just a protobatcher that makes a 
much larger batch. We're going to fill up ram with as many batches as we can manage, wait for them to finish, then
fire off another blast.

Note that this is mainly written with the fact that I intend to adapt this into a continuous batcher later in mind.
There are far more optimal ways to run a shotgun-style batcher, but rather than make the best shotgun I could,
I aimed to make this an ideal stepping stone on the quest for a continuous batcher.
*/

import { getServers, copyScripts, checkTarget, isPrepped, prep } from "/part3/utils.js";

const TYPES = ["hack", "weaken1", "grow", "weaken2"];
const WORKERS = ["/part3/tHack.js", "/part3/tWeaken.js", "/part3/tGrow.js"];
const SCRIPTS = { hack: "/part3/tHack.js", weaken1: "/part3/tWeaken.js", grow: "/part3/tGrow.js", weaken2: "/part3/tWeaken.js" };
const COSTS = { hack: 1.7, weaken1: 1.75, grow: 1.75, weaken2: 1.75 };
// We won't be using the offsets anymore, but I've left them here in case we bring them back for a later part.
// const OFFSETS = { hack: 0, weaken1: 1, grow: 2, weaken2: 3 };

/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");
	ns.tail();

	while (true) {
		// Setup is mostly the same.
		const dataPort = ns.getPortHandle(ns.pid);
		dataPort.clear();
		let target = "n00dles";
		const servers = getServers(ns, (server) => {
			target = checkTarget(ns, server, target, ns.fileExists("Formulas.exe", "home"));
			copyScripts(ns, server, WORKERS, true);
			return ns.hasRootAccess(server);
		});
		const ramNet = new RamNet(ns, servers);
		const metrics = new Metrics(ns, target);
		if (!isPrepped(ns, target)) await prep(ns, metrics, ramNet);
		ns.clearLog();
		ns.print("Optimizing. This may take a few seconds...")

		/*
		New optimizer is async because it can take upwards of 5 seconds to run. We can afford the heavy
		computations because shotgun batchers are very front-loaded. In a "real" shotgun batcher, you'll want
		to modify the ramnet so that you can do this during the downtime between mega-batches.
		*/
		await optimizeShotgun(ns, metrics, ramNet); // See the function below for details.
		metrics.calculate(ns);

		// I've renamed the schedule array from "batch" to "jobs" just for clarity purposes.
		// The batchCount declaration has also been moved down here because we use it for scheduling.
		const jobs = [];
		let batchCount = 0;

		// Another change. Instead of tracking the end times by type, I'm now using a unified end time.
		// This makes the scheduling a bit simpler as long as we're always going in chronological order.
		metrics.end = Date.now() + metrics.wTime - metrics.spacer;

		// Instead of one batch, we repeat the scheduling based on the depth calculated by the optimizer.
		while (batchCount++ < metrics.depth) {
			for (const type of TYPES) {
				// As you can see, calculating the end time for each new job is much simpler this way.
				// The rest of the scheduling is mostly unchanged.
				metrics.end += metrics.spacer;

				// Batchcount is part of the constructor now. Yes I was that lazy in the last part.
				const job = new Job(type, metrics, batchCount);
				if (!ramNet.assign(job)) {
					ns.print(`ERROR: Unable to assign ${type}. Dumping debug info:`);
					ns.print(job);
					ns.print(metrics);
					ramNet.printBlocks(ns);
					return;
				}
				jobs.push(job);
			}
		}

		/*
		Deployment is completely unchanged. However, with the much larger batch sizes, you may find that
		this can potentially freeze the game for minutes at a time. If it's too disruptive or triggers the
		infinite loop failsafe, you can uncomment the sleep line.

		There's really no need to do this synchronously for our batcher, but in a "real" shotgun batcher, you wouldn't
		use any spacers at all, and try to keep deployment time and execution time down to as little as possible in order
		to minimize downtime.
		*/
		for (const job of jobs) {
			job.end += metrics.delay;
			const jobPid = ns.exec(SCRIPTS[job.type], job.server, { threads: job.threads, temporary: true }, JSON.stringify(job));
			if (!jobPid) throw new Error(`Unable to deploy ${job.type}`);
			const tPort = ns.getPortHandle(jobPid);
			await tPort.nextWrite();
			metrics.delay += tPort.read();
		}

		/*
		This is a silly hack. Due to the way arrays work in JS, pop() is much faster than shift() and we're
		going to be accessing these jobs in FIFO order in a moment (ie. a queue). Since we've got lots of downtime
		and the jobs array can get really huge, I just reverse them now to save time later.

		We'll be implementing a more sophisticated schedule in the next part.
		*/
		jobs.reverse();
		
		// I've stepped up the logging/feedback a bit here, but it's otherwise pretty much the same.
		const timer = setInterval(() => {
			ns.clearLog();
			ns.print(`Hacking ~\$${ns.formatNumber(metrics.maxMoney * metrics.greed * batchCount * metrics.chance)} from ${metrics.target}`);
			ns.print(`Greed: ${Math.floor(metrics.greed * 1000) / 10}%`);
			ns.print(`Ram available: ${ns.formatRam(ramNet.totalRam)}/${ns.formatRam(ramNet.maxRam)}`);
			ns.print(`Total delay: ${metrics.delay}ms`);
			ns.print(`Active jobs remaining: ${jobs.length}`);
			ns.print(`ETA ${ns.tFormat(metrics.end - Date.now())}`);
		}, 1000);
		ns.atExit(() => {
			clearInterval(timer);
		});

		/*
		As each job finishes, we update the ramnet to reflect it. Once the queue is empty, we start over.
		Updating the ramnet like this isn't really necessary since we're just going to rebuild it entirely in
		the next iteration, but I wanted to demonstrate what it will look like in preparation for the next part.
		*/
		do {
			await dataPort.nextWrite();
			dataPort.clear();

			// It's technically possible that some of these might finish out of order due to lag or something.
			// But it doesn't actually matter since we're not doing anything with this data yet.
			ramNet.finish(jobs.pop());
		} while (jobs.length > 0);
		clearInterval(timer);
	}
}

// The Job class, lean as it is, remains mostly unchanged. I got rid of the server argument since I wasn't using it
// and added a batch number instead.
class Job {
	constructor(type, metrics, batch) {
		this.type = type;
		// this.end = metrics.ends[type]; // Left in for now, in case I decided to use it again later.
		this.end = metrics.end; // Using the unified end time now.
		this.time = metrics.times[type];
		this.target = metrics.target;
		this.threads = metrics.threads[type];
		this.cost = this.threads * COSTS[type];
		this.server = "none";
		this.report = true; // All workers now report when they finish.
		this.port = metrics.port;
		this.batch = batch;

		// Future stuff. Ignore these.
		// this.status = "active";
		// this.id = type + batch;
	}
}

// Almost entirely the same, aside from the changes to end time.
/** @param {NS} ns */
class Metrics {
	constructor(ns, server) {
		this.target = server;
		this.maxMoney = ns.getServerMaxMoney(server);
		this.money = Math.max(ns.getServerMoneyAvailable(server), 1);
		this.minSec = ns.getServerMinSecurityLevel(server);
		this.sec = ns.getServerSecurityLevel(server);
		this.prepped = isPrepped(ns, server);
		this.chance = 0;
		this.wTime = 0;
		this.delay = 0;
		this.spacer = 5;
		this.greed = 0.1;
		this.depth = 0; // The number of concurrent batches to run. Set by the optimizer.

		this.times = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };
		this.end = 0; // Slight change for the new timing. The old way in commented out in case I switch back later.
		// this.ends = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };
		this.threads = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };

		this.port = ns.pid;
	}

	// Almost totally unchanged, except that I've commented out the default depth calculation, since it's done elsewhere.
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
		// this.depth = this.wTime / this.spacer * 4;

		const hPercent = ns.hackAnalyze(server);
		const amount = maxMoney * greed;
		const hThreads = Math.max(Math.floor(ns.hackAnalyzeThreads(server, amount)), 1);
		const tGreed = hPercent * hThreads;

		// Okay I lied. We now overestimate grow threads by 1%. This helps prevent level ups from causing desyncs.
		// Only a little, though. If you gain too many levels per shotgun blast, it will still have to re-prep the server.
		const gThreads = Math.ceil(ns.growthAnalyze(server, maxMoney / (maxMoney - maxMoney * tGreed)) * 1.01);
		this.threads.weaken1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		this.threads.weaken2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);
		this.threads.hack = hThreads;
		this.threads.grow = gThreads;
		this.chance = ns.hackAnalyzeChance(server);
	}
}

// Once again, not a whole lot of changes. I've added a new function in support of the optimizer. Details below.
/** @param {NS} ns */
class RamNet {
	#blocks = [];
	#minBlockSize = Infinity;
	#maxBlockSize = 0;
	#totalRam = 0;
	#maxRam = 0;
	#prepThreads = 0;
	#index = new Map();
	constructor(ns, servers) {
		for (const server of servers) {
			if (ns.hasRootAccess(server)) {
				const maxRam = ns.getServerMaxRam(server);
				const ram = maxRam - ns.getServerUsedRam(server);
				if (ram >= 1.60) {
					const block = { server: server, ram: ram };
					this.#blocks.push(block);
					if (ram < this.#minBlockSize) this.#minBlockSize = ram;
					if (ram > this.#maxBlockSize) this.#maxBlockSize = ram;
					this.#totalRam += ram;
					this.#maxRam += maxRam;
					this.#prepThreads += Math.floor(ram / 1.75);
				}
			}
		}
		this.#sort();
		this.#blocks.forEach((block, index) => this.#index.set(block.server, index));
	}

	#sort() {
		this.#blocks.sort((x, y) => {
			if (x.server === "home") return 1;
			if (y.server === "home") return -1;

			return x.ram - y.ram;
		});
	}

	get totalRam() {
		return this.#totalRam;
	}

	get maxRam() {
		return this.#maxRam;
	}

	get maxBlockSize() {
		return this.#maxBlockSize;
	}

	get prepThreads() {
    		return this.#prepThreads;
  	}

	getBlock(server) {
		if (this.#index.has(server)) {
			return this.#blocks[this.#index.get(server)];
		} else {
			throw new Error(`Server ${server} not found in RamNet.`);
		}
	}

	assign(job) {
		const block = this.#blocks.find(block => block.ram >= job.cost);
		if (block) {
			job.server = block.server;
			block.ram -= job.cost;
			this.#totalRam -= job.cost;
			return true;
		} else return false;
	}

	finish(job) {
		const block = this.getBlock(job.server);
		block.ram += job.cost;
		this.#totalRam += job.cost;
	}

	cloneBlocks() {
		return this.#blocks.map(block => ({ ...block }));
	}

	printBlocks(ns) {
		for (const block of this.#blocks) ns.print(block);
	}

	// This function takes an array of job costs and simulates assigning them to see how many batches it can fit.
	testThreads(threadCosts) {
		// Clone the blocks, since we don't want to actually change the ramnet.
		const pRam = this.cloneBlocks();
		let batches = 0;
		let found = true;
		while (found) {
			// Pretty much just a copy of assign(). Repeat until a batch fails to assign all it's jobs.
			for (const cost of threadCosts) {
				found = false;
				const block = pRam.find(block => block.ram >= cost);
				if (block) {
					block.ram -= cost;
					found = true;
				} else break;
			}
			if (found) batches++; // If all of the jobs were assigned successfully, +1 batch and loop.
		}
		return batches; // Otherwise, we've found our number.
	}
}

// This one's got some pretty big changes, even if it doesn't look like it. For one, it's now async, and you'll see why.
/**
 * @param {NS} ns
 * @param {Metrics} metrics
 * @param {RamNet} ramNet
 */
async function optimizeShotgun(ns, metrics, ramNet) {
	// Setup is mostly the same.
	const maxThreads = ramNet.maxBlockSize / 1.75;
	const maxMoney = metrics.maxMoney;
	const hPercent = ns.hackAnalyze(metrics.target);
	const wTime = ns.getWeakenTime(metrics.target); // We'll need this for one of our calculations.

	const minGreed = 0.001;
	const stepValue = 0.01; // Step value is now 10x higher. If you think that's overkill, it's not.
	let greed = 0.99;
	let best = 0; // Initializing the best value found.

	// This algorithm starts out pretty much the same. We begin by weeding out the obviously way too huge greed levels.
	while (greed > minGreed) {
		const amount = maxMoney * greed;
		const hThreads = Math.max(Math.floor(ns.hackAnalyzeThreads(metrics.target, amount)), 1);
		const tGreed = hPercent * hThreads;
		// 1% overestimation here too. Always make sure your calculations match.
		const gThreads = Math.ceil(ns.growthAnalyze(metrics.target, maxMoney / (maxMoney - maxMoney * tGreed)) * 1.01);

		if (Math.max(hThreads, gThreads) <= maxThreads) {
			const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
			const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);

			const threadCosts = [hThreads * 1.7, wThreads1 * 1.75, gThreads * 1.75, wThreads2 * 1.75];
			
			// These lines were supposed to help weed out a few more too-high values, but in my unit tests they never
			// actually did anything. Uncomment them if you want.
			// const totalCost = threadCosts.reduce((t, c) => t + c);
			// if (totalCost > ramNet.totalRam) continue;

			/*
			Here's where it all changes. First we calculate the number of batches we can fit into ram at the current
			greed level. Then we calculate how much money that nets and how long it will take. If that income/time is
			better than what we've found before, we update the metrics and then continue.

			Unlike the previous version, this one checks every value. Between that and the loop to simulate assigning
			jobs, this is a very heavy algorithm that can take seconds to execute if done synchronously. To prevent it
			from freezing the game, we run it asynchronously and sleep after checking each value.
			*/
			const batchCount = ramNet.testThreads(threadCosts);
			const income = tGreed * maxMoney * batchCount / (metrics.spacer * 4 * batchCount + wTime);
			if (income > best) {
				best = income;
				metrics.greed = tGreed;
				metrics.depth = batchCount;
			}
		}
		await ns.sleep(0);
		greed -= stepValue;
	}
	// Added the check here to only throw an error if we failed to find any valid configurations.
	if (best === 0) throw new Error("Not enough ram to run even a single batch. Something has gone seriously wrong.");
}
