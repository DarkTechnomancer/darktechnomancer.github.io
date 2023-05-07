/*
Only changes from part 3 are commented. If you'd like to know more about the underlying ideas,
either read the guide or go back to parts 1-3 for the comments there.

The continuous batcher is going to combine what we've learned from the proto-batcher and shotgun
versions in order to maintain a constant flow of tasks. We'll use our shotgun strategy to deploy up to
a static depth, then use our proto-batcher strategy to maintain that depth by redeploying new batches
as each one finishes.

Note that I'm using folders, so you may need to find and remove /part4/ from all the scripts.
*/

import { getServers, buildRamNet, checkTarget, isPrepped, prep, optimizePeriodic, copyScripts } from "/part4/utils.js";

/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");
	ns.tail();

	// Flipped these back around since the new strategy requires that we deploy things in order.
	const types = ["hack", "weaken1", "grow", "weaken2"];
	const startTime = Date.now();  // Using this to keep track of runtime.
	let startLevel = ns.getHackingLevel();  // Keeping track of when we level up for recalculation.
	const dataPort = ns.getPortHandle(ns.pid);
	dataPort.clear();

	if (ns.isRunning("/part4/logHelper.js", "home")) ns.kill("/part4/logHelper.js", "home");
	const logPort = ns.exec("/part4/logHelper.js", "home");
	// Instead of killing the log, we just close its tail at exit.
	// This is so that we don't lose the logs of any trailing scripts.
	ns.atExit(() => ns.closeTail(logPort));
	await ns.sleep(1);

	while (true) {
		let ramNet = [];
		const values = {
			totalThreads: 0,
			target: "n00dles",
			maxBlockSize: 0,
			minBlockSize: Infinity,
			depth: 0,
			spacer: 5,
			buffer: 0, // New strategy requires no buffer. Left here for posterity in case we need it again.
			greed: 0,
			log: logPort,
			// Dipping our toes into formulas. Don't worry, this script will work 100% fine without it.
			forms: ns.fileExists("Formulas.exe", "home"),
			// An array to help keep track of our worker scripts.
			// It took every ounce of my self-control not to make this a map.
			workers: ["/part4/tHack.js", "/part4/tWeaken.js", "/part4/tGrow.js"]
		}

		getServers(
			ns,
			(ns, server, pVal = values, pRam = ramNet) => {
				checkTarget(ns, server, pVal);
				buildRamNet(ns, server, pRam, pVal);
				copyScripts(ns, server, pVal, true); // New function for copying scripts to servers, details below.
			}
		)

		if (!isPrepped(ns, values.target)) {
			await prep(ns, values);
			ramNet = [];
			values.minBlockSize = Infinity;
			values.maxBlockSize = 0;
			values.totalThreads = 0;
			getServers(
				ns,
				(ns, server, pVal = values, pRam = ramNet) => {
					buildRamNet(ns, server, pRam, pVal);
					copyScripts(ns, server, pVal, false);
				}
			)
		}
		ramNet.sort((x, y) => x.ram - y.ram);

		// We need depth for the optimizer, and we need wTime for depth, so wTime is up here now.
		// The others came along for the ride just to keep the derived values close together.
		const wTime = ns.getWeakenTime(values.target);
		const hTime = wTime / 4;
		const gTime = hTime * 3.2;
		const times = { hack: hTime, weaken1: wTime, grow: gTime, weaken2: wTime };

		/*
		In part 3 I briefly discussed depth, but it's going to be way more important now.
		Like before, this is the number of concurrent batches that will be active at any given time.
		Unlike the shotgun, however, this number is more than just a useful metric to keep track of
		while coding. Now, it's a crucial element in our strategy.
		
		Depth is effectively the minimum number of concurrent scripts that will support our batcher
		at its optimal rate. Our shotgun didn't care about depth; it just wanted whatever made the most money
		and could fit in ram. For a continuous batcher, it's different.

		For a continuous batcher, depth is everything. It's all about batches per second. The priority is
		fits in ram > highest depth > highest greed.

		That may seem like a lot of comment for a single line of code, but trust me, this is a very important
		line of code. The main takeaway should be this: as unintuitive as it may seem, the continuous
		batcher will sometimes be running *way more batches* at a time than the shotgun.
		*/
		values.depth = Math.ceil(wTime / (values.spacer * 4));

		// New optimizer is similar but distict from the old one. See utils for details.
		optimizePeriodic(ns, values, ramNet);

		const maxMoney = ns.getServerMaxMoney(values.target);
		const amount = maxMoney * values.greed;
		const hThreads = Math.max(Math.min(Math.floor(ns.hackAnalyzeThreads(values.target, amount)), Math.floor(ramNet.slice(-2)[0].ram / 1.7)), 1);
		const tAmount = ns.hackAnalyze(values.target) * hThreads;
		const gThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * tAmount))) * 1.01);
		const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);
		const threads = { hack: hThreads, weaken1: wThreads1, grow: gThreads, weaken2: wThreads2 };

		let batchEnd = Date.now() + wTime + values.buffer;
		let batchCount = 0;
		// Depth can get *very* high with this strategy. This initial deployment may freeze the game for 30-40 seconds.
		// If your computer is struggling to run this, try increasing the spacer.
		while (batchCount < values.depth) {
			// This has been given its own function. See below for details.
			batchEnd = await deployBatch(ns, types, ramNet, values, threads, batchEnd, batchCount++);
			if (batchCount > values.depth * 2) {
				// Infinite loop safety net. Should never happen unless something goes very wrong.
				ns.print("ERROR: Infinite loop failsafe triggered.");
				// If this happens, put your debugging stuff here.
				return;
			}
			ns.clearLog();
			ns.print(`Deploying initial batches: ${batchCount}/${values.depth}`);
		}
		ns.print(`...done.`);
		ns.print(`Waiting for data... ETA ${new Date(Date.now() + wTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "numeric", second: "numeric", hour12: true })} (~${ns.tFormat(wTime)})`);
		mainLoop: while (true) { // Using a label here to allow a certain break statement to jump scope.
			const runTime = Date.now() - startTime;

			// I've adjusted the logging again, just a little. We're also back to listening for every weaken2.
			ns.print(`Target: ${values.target}`);
			ns.print(`Batches deployed: ${batchCount}`);
			ns.print(`Target depth: ${Math.floor(values.depth)}`);
			ns.print(`Greed level: ${Math.round(values.greed * 1000) / 10}%`);
			ns.print(`Allocated RAM: ${ns.formatRam(threads.hack * 1.7 + (threads.weaken1 + threads.weaken2 + threads.grow) * 1.75 * values.depth)}`);
			ns.print(`Unallocated RAM: ${ns.formatRam(values.totalThreads * 1.75)}`);
			ns.print(`Expected yield: \$${ns.formatNumber(tAmount * maxMoney * (1000 / (values.spacer * 4)), 2)} per second`);
			ns.print(`Runtime: ${ns.tFormat(runTime, true)}`);

			await dataPort.nextWrite();
			// This is in a do...while loop in case deploying batches oversteps the trigger to deploy more.
			do {
				ns.clearLog();
				// If we level up, we recalculate everything.
				if (ns.getHackingLevel() !== startLevel) {
					startLevel = ns.getHackingLevel();
					// This returns true if a better target is found, in which case we break the main loop and start over.
					if (recalculateMetrics(ns, values, ramNet, times, threads)) break mainLoop;
				} else {
					// If we don't level up, just keep track of our ram.
					// Still probably should have made this an independent function, but I'm lazy.
					ramNet = [];
					values.minBlockSize = Infinity;
					values.maxBlockSize = 0;
					values.totalThreads = 0;
					getServers(
						ns,
						(ns, server, pVal = values, pRam = ramNet) => {
							buildRamNet(ns, server, pRam, pVal);
							copyScripts(ns, server, pVal, false);
						}
					)
					ramNet.sort((x, y) => x.ram - y.ram);
				}

				// Deploy the new batch.
				if (dataPort.read() === "weaken2") {
					if (!isPrepped(ns, values.target)) {
						ns.print("WARN: Potential desync");
						// If you run into any desyncing problems, put a return and error handling here to debug it.
						// In my tests, desyncs were extremely rare and always self-correcting, so I removed the return.
					}
					batchEnd = await deployBatch(ns, types, ramNet, values, threads, batchEnd, batchCount++);
				}
			} while (!dataPort.empty());
		}
		// Clean up leftover scripts when switching targets to prevent port collisions.
		getServers(ns, (ns, server) => {
			for (const pid of ns.ps(server)) {
				if (workers.includes(pid.filename)) ns.kill(pid);
			}
		});
		dataPort.clear();
	}
}

/*
	New function for deploying scripts. I used the shotgun loop from part 3 as a base, but there's a lot
	of major differences. I'll go over them line by line.
*/
async function deployBatch(ns, types, ramNet, values, threads, batchEnd, batchCount) {
	// Recalculating times for every single batch.
	// This is to prevent temporary desyncs from turning into permanent ones.
	const wTime = ns.getWeakenTime(values.target);
	const hTime = wTime / 4;
	const gTime = hTime * 3.2;
	const hEnd = batchEnd + values.spacer * 1;
	const wEnd1 = batchEnd + values.spacer * 2;
	const gEnd = batchEnd + values.spacer * 3;
	const wEnd2 = batchEnd + values.spacer * 4;

	const times = { hack: hTime, weaken1: wTime, grow: gTime, weaken2: wTime };
	const ends = { hack: hEnd, weaken1: wEnd1, grow: gEnd, weaken2: wEnd2 };
	const scripts = { hack: "/part4/tHack.js", weaken1: "/part4/tWeaken.js", grow: "/part4/tGrow.js", weaken2: "/part4/tWeaken.js" };

	let delay = 0;  // You'll see what this is for in a moment.
	for (const type of types) {
		// Note the addition of '+ delay' to the end time in metrics.
		const metrics = { batch: batchCount, target: values.target, type: type, time: times[type], end: ends[type] + delay, port: ns.pid, log: values.log };
		for (const block of ramNet) {
			const cost = ns.getScriptRam(scripts[type]);
			if (block.ram / cost >= threads[type] && !block.used) {
				/* 
				This is where the major differences begin. I'm using a "ping-pong" strategy to deploy scripts,
				meaning that each script is deployed with its own port, and we don't deploy the next one until it
				successfully reports back.

				The main advantage of this is that it allows us to adjust the end time of the next task if the
				previous one is delayed. This means that we no longer have to cancel scripts that land late, no longer
				need a buffer to deploy scripts (even if the game freezes or lags), and can still ensure that everything
				lands in the correct order.
				*/
				const pid = ns.exec(scripts[type], block.server, threads[type], JSON.stringify(metrics));
				// Just a safety check in case the exec fails somehow. Should NEVER happen, but as always we're playing it safe.
				if (pid) {
					const port = ns.getPortHandle(pid);
					await port.nextWrite();
					delay += port.read();
					const assigned = threads[type] * cost;
					block.ram -= assigned;
					values.totalThreads -= threads[type] * cost / 1.75;
					if (block.ram < 1.7) block.used = true;
				}
				break;
			}
		}
	}
	return wEnd2 + delay; // Return the new end of our queue.
}

// Just a simple function to save us having to duplicate code every time we want to calculate stuff.
function recalculateMetrics(ns, values, ramNet, times, threads) {
	const previousTarget = values.target;
	ramNet = [];
	values.minBlockSize = Infinity;
	values.maxBlockSize = 0;
	values.totalThreads = 0;
	getServers(
		ns,
		(ns, server, pVal = values, pRam = ramNet) => {
			checkTarget(ns, server, pVal);
			buildRamNet(ns, server, pRam, pVal);
			copyScripts(ns, server, pVal, false);
		}
	)
	if (values.target !== previousTarget) return true; // If we find a new target, abort and tell the main program to reset.
	ramNet.sort((x, y) => x.ram - y.ram);

	const wTime = ns.getWeakenTime(values.target);
	times.weaken1 = wTime;
	times.weaken2 = wTime;
	times.hack = wTime / 4;
	times.grow = wTime * 0.8;
	values.depth = Math.ceil(wTime / (values.spacer * 4));

	optimizePeriodic(ns, values, ramNet);

	const maxMoney = ns.getServerMaxMoney(values.target);
	const amount = maxMoney * values.greed;
	const hThreads = Math.max(Math.min(Math.floor(ns.hackAnalyzeThreads(values.target, amount)), Math.floor(ramNet.slice(-2)[0].ram / 1.7)), 1);
	const tAmount = ns.hackAnalyze(values.target) * hThreads;
	const gThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * tAmount))) * 1.01);
	threads.hack = hThreads;
	threads.grow = gThreads;
	threads.weaken1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
	threads.weaken2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);
	return false;  // Still on the same target, no reset needed.
}
