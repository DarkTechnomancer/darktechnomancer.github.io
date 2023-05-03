/*
Only changes from part 1 are commented. If you'd like to know more about the underlying ideas,
either read the guide or go back to part 1 and read the comments there.
*/

// Moved some helper functions into a utility library to keep things neat and so that other programs can use them if needed.
// Among them are the lambda predicates we used in getServers. They are now pre-defined in utils.js
import { getServers, buildRamNet, checkTarget, isPrepped, prep } from "utils.js";

/** @param {NS} ns */
export async function main(ns) {
	let ramNet = []; // No longer a constant. This lets us rebuild it later if the environment changes.
	const values = {
		totalThreads: 0,
		target: "n00dles",
		maxBlockSize: 0,
		minBlockSize: Infinity,
	}
	const types = ["hack", "weaken1", "grow", "weaken2"];

	ns.disableLog("ALL");
	ns.tail();

	// Registering a new port with our program's ID.
	// PID should be a sufficiently unique identifier as long as we're only using one port per script.
	const dataPort = ns.getPortHandle(ns.pid);
	dataPort.clear(); // This should already be empty, but you can't be too safe with data validation.

	// With the lambdas predfined, this call looks much neater.
	// Also no longer a constant for the same reason as ramNet.
	let servers = getServers(
		ns,
		(ns, server, pVal = values, pRam = ramNet) => {
			checkTarget(ns, server, pVal);
			buildRamNet(ns, server, pRam, pVal);
		}
	)

	// If the server's not prepped, prep it then rebuild the memory map.
	if (!isPrepped(ns, values.target)) {
		await prep(ns, values);
		ramNet = [];
		values.minBlockSize = Infinity;
		values.maxBlockSize = 0;
		values.totalThreads = 0;
		servers = getServers(
			ns,
			(ns, server, pVal = values, pRam = ramNet) => {
				buildRamNet(ns, server, pRam, pVal);
			}
		)
	}

	// These are variables now, since we'll be recalculating them later.
	let maxThreads = Math.floor(values.maxBlockSize / 1.75); // Using the maxBlockSize value. I forgot about it last time.
	let maxMoney = ns.getServerMaxMoney(values.target);
	let gThreads = 0;
	let greed = 0.99;
	while (greed >= 0.001) {
		const threads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * greed))));
		if (threads < maxThreads) {
			gThreads = threads;
			break;
		}
		greed -= 0.001;
	}

	// Now instead of doing only one batch, we'll run in a loop.
	while (true) {
		const tAmount = maxMoney * greed;
		const hThreads = Math.max(Math.min(Math.floor(ns.hackAnalyzeThreads(values.target, tAmount)), Math.floor(ramNet.slice(-2)[0].ram / 1.7)), 1);
		const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);

		// I removed the rounding on time calculations for better accuracy.
		const wTime = ns.getWeakenTime(values.target);
		const hTime = wTime / 4;
		const gTime = hTime * 3.2;

		// Spacing is the same, but I've tightened up the buffer and start times significantly.
		// If you're getting script failures, try raising the buffer.
		const buffer = 5;
		const hEnd = Date.now() + wTime + -5 + buffer;
		const wEnd1 = Date.now() + wTime + 0 + buffer;
		const gEnd = Date.now() + wTime + 5 + buffer;
		const wEnd2 = Date.now() + wTime + 10 + buffer;

		const times = { hack: hTime, weaken1: wTime, grow: gTime, weaken2: wTime };
		const threads = { hack: hThreads, weaken1: wThreads1, grow: gThreads, weaken2: wThreads2 };
		const ends = { hack: hEnd, weaken1: wEnd1, grow: gEnd, weaken2: wEnd2 };
		const scripts = { hack: "tHack.js", weaken1: "tWeaken.js", grow: "tGrow.js", weaken2: "tWeaken.js" };



		for (const type of types) {
			const metrics = { target: values.target, type: type, time: times[type], end: ends[type], port: ns.pid };
			for (const block of ramNet) {
				if (block.ram / 1.75 >= threads[type] && !block.used) {
					ns.scp(scripts[type], block.server);
					ns.exec(scripts[type], block.server, threads[type], JSON.stringify(metrics));
					
					// Switched this condition to allow reusing blocks.
					block.ram -= threads[type] * ns.getScriptRam(scripts[type]);
					break;
				}
			}
		}

		// Logging. Some useful info to let us know what's happening.
		ns.clearLog();
		ns.print(`Target: ${values.target}`);
		ns.print(`Greed level: ${greed * 100}%`);
		ns.print(`RAM allocated: ${threads.hack * 1.7 + (threads.weaken1 + threads.weaken2 + threads.grow) * 1.75}/${values.totalThreads * 1.75} GBs`);
		ns.print(`Expected yield: \$${ns.formatNumber(tAmount * (60000 / (wTime + 20 + buffer)), 2)} per minute`); // Change 60000 to 1000 if you'd rather have $/sec
		ns.print(`Next batch at ${new Date(wEnd2).toLocaleTimeString(undefined, { hour: "numeric", minute: "numeric", second: "numeric", hour12: true })} (~${ns.tFormat(wTime + 20 + buffer)})`);

		/*
		For performance reasons, we're repopulating our server list now instead of after the wait.
		There's a lot of stuff that needs calculating before the batch, and it's better to do the things that
		take a long time while we're waiting. Note that we do not want to calculate RAM now, since it's still being used.
		*/
		servers = getServers(
			ns,
			(ns, server, pVal = values) => {
				checkTarget(ns, server, pVal);
				if (ns.hasRootAccess(server)) return true;
			}
		)

		// The greed calculation takes forever in computer time (a few ms) so we definitely want to do that now.
		// It means using outdated max values if we've picked up more ram in the meantime, but it's worth it.
		maxThreads = Math.floor(values.maxBlockSize / 1.75);
		maxMoney = ns.getServerMaxMoney(values.target);
		gThreads = 0;
		greed = 0.99;
		while (greed >= 0.001) {
			const threads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * greed))));
			if (threads < maxThreads) {
				gThreads = threads;
				break;
			}
			greed -= 0.001;
		}

		// Wait until the previous batch is finished before starting the next one.
		await dataPort.nextWrite();

		// If our target isn't prepped for whatever reason, we'll re-prep it here.
		// Should never happen while we're on the same target, but could on a switch.
		if (!isPrepped(ns, values.target)) await prep(ns, values);

		/*
		I decided to just rebuild the entire memory map after each batch.
		It doesn't make much difference now, but this will let us adapt better to changing conditions
		and will be very useful when running batches in parallel.
		*/
		ramNet = [];
		values.minBlockSize = Infinity;
		values.maxBlockSize = 0;
		values.totalThreads = 0;
		servers = getServers(
			ns,
			(ns, server, pVal = values, pRam = ramNet) => {
				buildRamNet(ns, server, pRam, pVal);
			}
		)
		ramNet.sort((x, y) => x.ram - y.ram);
	}
}
