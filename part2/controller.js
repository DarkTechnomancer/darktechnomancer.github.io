/*
Welcome to part 2. I'll only be commenting on things that have changed from the previous part, so if there's something
confusing, be sure to go back and look at part 1 for more detailed explanations.

For part 2, we'll be making a protobatcher. Essentially that means we'll be running our previous version in a constant loop.
To facilitate this, and because otherwise there wouldn't really be much to this part, we're going to refine the way our
scripts communicate with each other using ports.
*/

import { getServers, copyScripts, checkTarget, isPrepped, prep } from "/part2/utils.js";

const TYPES = ["hack", "weaken1", "grow", "weaken2"];
const WORKERS = ["/part2/tHack.js", "/part2/tWeaken.js", "/part2/tGrow.js"];
const SCRIPTS = { hack: "/part2/tHack.js", weaken1: "/part2/tWeaken.js", grow: "/part2/tGrow.js", weaken2: "/part2/tWeaken.js" };
const COSTS = { hack: 1.7, weaken1: 1.75, grow: 1.75, weaken2: 1.75 };
const OFFSETS = { hack: 0, weaken1: 1, grow: 2, weaken2: 3 };

/*
Most of the changes are in the main function, so I've moved it up top. I generally prefer having the main function at the
top of the file anyway.
*/
/** @param {NS} ns */
export async function main(ns) {
	// Moving most of our active feeback to the tail window so that batches finishing don't get swept away.
	ns.disableLog("ALL");
	ns.tail();

	// Stick the whole script in a loop. That's it, see you in part 3.
	// Just kidding, there's a bit more to it.
	let batchCount = 0;
	while (true) {
		// Register a port using the script's unique handle.
		// I like to keep ports strictly coupled to a specific script, but you can use whatever number you like.
		const dataPort = ns.getPortHandle(ns.pid);
		dataPort.clear() // Make sure there's no random data left in the port.

		let target = "n00dles";
		const servers = getServers(ns, (server) => {
			// Don't worry if you don't have Formulas, it's not needed at all here.
			target = checkTarget(ns, server, target, ns.fileExists("Formulas.exe", "home"));
			copyScripts(ns, server, WORKERS, true);
			return ns.hasRootAccess(server);
		});
		const ramNet = new RamNet(ns, servers);
		const metrics = new Metrics(ns, target);
		if (!isPrepped(ns, target)) await prep(ns, metrics, ramNet);
		optimizeBatch(ns, metrics, ramNet); // The same optimization algorithm works just fine for protobatching.
		metrics.calculate(ns);

		const batch = [];
		batchCount++;
		for (const type of TYPES) {
			// We've removed the buffer. You'll see why later.
			metrics.ends[type] = Date.now() + metrics.wTime + metrics.spacer * OFFSETS[type];
			const job = new Job(type, metrics);
			job.batch = batchCount; // This is a bit of a hack. We'll do it better in the next part.
			if (!ramNet.assign(job)) {
				ns.print(`ERROR: Unable to assign ${type}. Dumping debug info:`);
				ns.print(job);
				ns.print(metrics);
				ramNet.printBlocks(ns);
				return;
			}
			batch.push(job);
		}

		// We do a bit more during deployment now.
		for (const job of batch) {
			job.end += metrics.delay;
			const jobPid = ns.exec(SCRIPTS[job.type], job.server, job.threads, JSON.stringify(job));
			if (!jobPid) throw new Error(`Unable to deploy ${job.type}`); // If the exec fails for any reason, error out.
			/*
			If a worker deploys late, it will communicate back how late it was, so that the other scripts can adjust.
			Note that for this we use the *worker's* port instead of our controller's port. It's good practice to make
			sure your ports have a very narrow focus.
			*/
			const tPort = ns.getPortHandle(jobPid);
			await tPort.nextWrite();
			metrics.delay += tPort.read();
		}

		const timer = setInterval(() => {
			ns.clearLog();
			ns.print(`Hacking \$${ns.formatNumber(metrics.maxMoney * metrics.greed)} from ${metrics.target}`)
			ns.print(`Running batch: ETA ${ns.tFormat(metrics.ends.weaken2 - Date.now())}`);
		}, 1000);
		ns.atExit(() => {
			clearInterval(timer);
		});
		// Wait for the weaken2 worker to report back. For now I've just hardcoded the Job class to tell only
		// weaken2 to report. This behavior will change later.
		await dataPort.nextWrite();
		dataPort.clear(); // For now we don't actually need the information here, we're just using it for timing.
		clearInterval(timer);
	}
}

class Job {
	constructor(type, metrics, server = "none") {
		this.type = type;
		this.end = metrics.ends[type];
		this.time = metrics.times[type];
		this.target = metrics.target;
		this.threads = metrics.threads[type];
		this.cost = this.threads * COSTS[type];
		this.server = server;
		this.report = this.type === "weaken2"; // For now, only w2 jobs report.
		this.port = metrics.port; // This lets the workers know which port to write to.
		this.batch = 0; // We'll keep track of how many we've run, just because we can.
	}
}

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
		this.delay = 0; // The cumulative delays caused by late jobs.
		this.spacer = 5;
		this.greed = 0.1;
		this.depth = 0; // Still not using this.

		this.times = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };
		this.ends = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };
		this.threads = { hack: 0, weaken1: 0, grow: 0, weaken2: 0 };

		this.port = ns.pid;
	}

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

/** @param {NS} ns */
class RamNet {
	#blocks = [];
	#minBlockSize = Infinity;
	#maxBlockSize = 0;
	#totalRam = 0;
	#maxRam = 0;
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

	getBlock(server) {
		if (this.#index.has(server)) {
			return this.#blocks[this.#index.get(server)];
		} else {
			throw new Error(`Server ${server} not found in RamNet.`);
		}
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
}

/**
 * @param {NS} ns
 * @param {Metrics} metrics
 * @param {RamNet} ramNet
 */
export function optimizeBatch(ns, metrics, ramNet) {
	const maxThreads = ramNet.maxBlockSize / 1.75;
	const maxMoney = metrics.maxMoney;
	const hPercent = ns.hackAnalyze(metrics.target);

	const minGreed = 0.001;
	const stepValue = 0.001;
	let greed = 0.99;
	while (greed > minGreed) {
		const amount = maxMoney * greed;
		const hThreads = Math.max(Math.floor(ns.hackAnalyzeThreads(metrics.target, amount)), 1);
		const tGreed = hPercent * hThreads;
		const gThreads = Math.ceil(ns.growthAnalyze(metrics.target, maxMoney / (maxMoney - maxMoney * tGreed)));

		if (Math.max(hThreads, gThreads) <= maxThreads) {
			const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
			const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);

			const threadCosts = [hThreads * 1.7, wThreads1 * 1.75, gThreads * 1.75, wThreads2 * 1.75];

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
				break;
			}
			if (found) {
				metrics.greed = greed;
				metrics.threads = { hack: hThreads, weaken1: wThreads1, grow: gThreads, weaken2: wThreads2 };
				return true;
			}
		}
		greed -= stepValue;
	}
	throw new Error("Not enough ram to run even a single batch. Something has gone seriously wrong.");
}