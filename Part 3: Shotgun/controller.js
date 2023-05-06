/*
Only changes from part 2 are commented. If you'd like to know more about the underlying ideas,
either read the guide or go back to parts 1 and 2 for the comments there.

The shotgun batcher I design here is very far from the best way to build a shotgun batcher.
I designed it with the plan to transition to continuous batchers in mind, and as such it has some
constraints that don't make sense for a truely optimized shotgun strategy.

Note that I've started using folders, so you may need to find and remove /part3/ from all the scripts.
*/

import { getServers, buildRamNet, checkTarget, isPrepped, prep, optimizeShotgun } from "/part3/utils.js";

/** @param {NS} ns */
export async function main(ns) {
	/*
	I've reversed the type index. By allocating ram backwards, we can help avoid desyncs.
	Not that it helps much; early on this will level you up like crazy and desync pretty much no matter what.
	Still, at least this guarantees that *security* will never be a problem.
	*/
	const types = ["weaken2", "grow", "weaken1", "hack"];
	ns.disableLog("ALL");
	ns.tail();
	const dataPort = ns.getPortHandle(ns.pid);
	dataPort.clear();

	// Spawns a special helper script for centralizing worker logs. See the script itself for details.
	if (ns.isRunning("/part3/logHelper.js", "home")) ns.scriptKill("/part3/logHelper.js", "home");
	const logPort = ns.exec("/part3/logHelper.js", "home");
	ns.atExit(() => ns.kill(logPort));  // Kill the logger when the controller ends.
	await ns.sleep(0); // This is just to give the helper a moment to initialize.

	/*
	The values map has grown. I moved greed into values (you'll see why later) and added depth and spacer.
	Spacer is something we were using before, just as int literals. Now we're defining it as a parameter, but it's
	still used the same way.

	Depth is the number of concurrent batches running in parallel. For continuous batchers there's a hard limit,
	but for a shotgun batcher this is limited only by ram. We don't actually need it here, but it's a helpful number
	to keep track of.
	*/
	while (true) { // Performance isn't much of a concern with shotgun, so we're just gonna loop the whole thing.
		let ramNet = [];
		const values = {
			totalThreads: 0,
			target: "n00dles",
			maxBlockSize: 0,
			minBlockSize: Infinity,
			depth: 0,
			spacer: 5,
			buffer: 2000,
			greed: 0,
			log: logPort
		}

		getServers(
			ns,
			(ns, server, pVal = values, pRam = ramNet) => {
				checkTarget(ns, server, pVal);
				buildRamNet(ns, server, pRam, pVal);
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
				}
			)
		}
		ramNet.sort((x, y) => x.ram - y.ram);

		// The brute force greed algorithm has been moved to a function. This is why greed was included in values.
		optimizeShotgun(ns, values, ramNet);

		const maxMoney = ns.getServerMaxMoney(values.target);
		const amount = maxMoney * values.greed;
		const hThreads = Math.max(Math.min(Math.floor(ns.hackAnalyzeThreads(values.target, amount)), Math.floor(ramNet.slice(-2)[0].ram / 1.7)), 1);
		const tAmount = ns.hackAnalyze(values.target) * hThreads;
		const gThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * tAmount))) * 1.01);
		const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);
		const threads = { hack: hThreads, weaken1: wThreads1, grow: gThreads, weaken2: wThreads2 };

		const wTime = ns.getWeakenTime(values.target);
		const hTime = wTime / 4;
		const gTime = hTime * 3.2;
		const times = { hack: hTime, weaken1: wTime, grow: gTime, weaken2: wTime };

		let batchEnd;
		let batchCount = 0;

		/*
		The reduce function is pretty hard to explain if you're not already familiar with it.
		Long story short, our optimization algorithm uses a rough approximation and we may not actually be able
		to allocate as many threads as it expects us to. The check here will make sure we've got enough ram to at least
		squeeze a grow and weaken in before allocating more.
		*/
		while (ramNet.reduce((chunks, block) => chunks + Math.floor(block.ram / ((gThreads + wThreads2) * 1.75)), 0) !== 0) {
			const offset = values.spacer * batchCount * 4; // You can see how we'r using the spacer more clearly here.
			const hEnd = Date.now() + wTime + values.buffer + values.spacer * 1 + offset;
			const wEnd1 = Date.now() + wTime + values.buffer + values.spacer * 2 + offset;
			const gEnd = Date.now() + wTime + values.buffer + values.spacer * 3 + offset;
			const wEnd2 = Date.now() + wTime + values.buffer + values.spacer * 4 + offset;

			const ends = { hack: hEnd, weaken1: wEnd1, grow: gEnd, weaken2: wEnd2 };
			const scripts = { hack: "/part3/tHack.js", weaken1: "/part3/tWeaken.js", grow: "/part3/tGrow.js", weaken2: "/part3/tWeaken.js" };

			// This is pretty much exactly the same except that we've added batch count and the log pid to the metrics.
			for (const type of types) {
				const metrics = { batch: batchCount, target: values.target, type: type, time: times[type], end: ends[type], port: ns.pid, log: logPort };
				for (const block of ramNet) {
					const cost = ns.getScriptRam(scripts[type]);
					if (block.ram / cost >= threads[type] && !block.used) {
						ns.scp(scripts[type], block.server);
						ns.exec(scripts[type], block.server, threads[type], JSON.stringify(metrics));

						const assigned = threads[type] * ns.getScriptRam(scripts[type]);
						block.ram -= assigned;
						if (block.ram < 1.7) block.used = true;
						break;
					}
				}
			}

			if (batchCount++ > values.depth * 10) {
				// Infinite loop safety net. Should never happen unless something goes very wrong.
				ns.print("ERROR: Infinite loop failsafe triggered.");
				// If this happens, put your debugging stuff here.
				return;
			}
			batchEnd = wEnd2;
		}
		do {
			/*
			Added some more stuff to the logging. Like the previous part, we wait for the last weaken worker
			to report back before starting over. We've just changed the way we can tell which one is last.
			*/
			ns.clearLog();
			ns.print(`Target: ${values.target}`);
			ns.print(`Batches deployed: ${batchCount}`);
			ns.print(`Target depth: ${Math.floor(values.depth)}`);
			ns.print(`Greed level: ${Math.round(values.greed * 1000) / 10}%`);
			ns.print(`RAM allocated: ${threads.hack * 1.7 + (threads.weaken1 + threads.weaken2 + threads.grow) * 1.75 * batchCount}/${values.totalThreads * 1.75} GBs`);
			ns.print(`Expected yield: \$${ns.formatNumber(batchCount * tAmount * maxMoney * (60000 / (values.spacer * 4 * batchCount + wTime + values.buffer)), 2)} per minute`);
			ns.print(`Next batch at ${new Date(batchEnd).toLocaleTimeString(undefined, { hour: "numeric", minute: "numeric", second: "numeric", hour12: true })} (~${ns.tFormat(batchEnd - Date.now())})`);
			await dataPort.nextWrite();
		} while (dataPort.read() !== batchCount - 1);
	}
}
