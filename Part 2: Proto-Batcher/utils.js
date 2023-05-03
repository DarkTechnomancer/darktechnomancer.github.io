/*
  The utility function library. The purpose of this library is to give a place for the sorts of functions
  that will often be used by multiple different scripts. This way we don't need to keep copying them.
 */

/** @param {NS} ns */
export async function main(ns) {
	ns.tprint("This is just a function library, it doesn't do anything.");
}

// The recursive server navigation algorithm.
/** @param {NS} ns */
export function getServers(ns, lambdaCondition = (ns, server) => true, hostname = "home", servers = [], visited = []) {
	if (visited.includes(hostname)) return;
	visited.push(hostname);
	if (lambdaCondition(ns, hostname)) servers.push(hostname);
	const connectedNodes = ns.scan(hostname);
	if (hostname !== "home") connectedNodes.shift();
	for (const node of connectedNodes) getServers(ns, lambdaCondition, node, servers, visited);
	return servers;
}

// The former lambda predicates, now promoted to full functions.
// Check target has been updated to use mininum security level as a proxy for minimum weaken time.
// Also now correctly uses half hacking level instead of full hacking level.
/** @param {NS} ns */
export function checkTarget(ns, server, pVal) {
	if (ns.getServerRequiredHackingLevel(server) <= ns.getHackingLevel() / 2) {
		const previousScore = ns.getServerMaxMoney(pVal.target) / ns.getServerMinSecurityLevel(pVal.target);
		const currentScore = ns.getServerMaxMoney(server) / ns.getServerMinSecurityLevel(server);
		if (currentScore > previousScore) pVal.target = server;
	}
}

/** @param {NS} ns */
export function buildRamNet(ns, server, pRam, pVal) {
	if (ns.hasRootAccess(server)) {
		const ram = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
		if (ram >= 1.60) {
			const block = { server: server, ram: ram, used: false };
			pRam.push(block);
			if (ram < pVal.minBlockSize) pVal.minBlockSize = ram;
			if (ram > pVal.maxBlockSize) pVal.maxBlockSize = ram;
			pVal.totalThreads += Math.floor(ram / 1.75);
			return true;
		}
	}
}

// A generic function to check that a given server is prepped. Mostly just a convenience.
export function isPrepped(ns, server) {
	const maxMoney = ns.getServerMaxMoney(server);
	const money = ns.getServerMoneyAvailable(server);
	const minSec = ns.getServerMinSecurityLevel(server);
	const sec = ns.getServerSecurityLevel(server);
	if (money < maxMoney || sec > minSec) return false;
	return true;
}

/*
This is the function I'm using to prep servers. It's not optimized and may be buggy. Not really part of the guide
but the rest of the code wouldn't function if I didn't include it. It's tested and functional, but I make no guarantees
about the quality. We'll be using a slightly modified proto-batch strategy for prepping.
*/
/** @param {NS} ns */
export async function prep(ns, values) {
	// Some initial values that get used later.
	let secDone = false;
	let startTime = Date.now();
	let batchCount = -1;
	let allocated = 0;

	while (true) {
		const maxMoney = ns.getServerMaxMoney(values.target);
		let money = ns.getServerMoneyAvailable(values.target);
		if (money === 0) money = 1; // This is just protection against a potential divide by zero error
		const minSec = ns.getServerMinSecurityLevel(values.target);
		const sec = ns.getServerSecurityLevel(values.target);

		// This probably looks familiar. Too familiar. Might be time to turn it into a function.
		// It builds the memory map we use to allocate threads, in case you forgot.
		const ramNet = [];
		values.minBlockSize = Infinity;
		values.maxBlockSize = 0;
		values.totalThreads = 0;
		getServers(
			ns,
			(ns, server, pVal = values, pRam = ramNet) => {
				buildRamNet(ns, server, pRam, pVal);
				return false;
			}
		)
		ramNet.sort((x, y) => x.ram - y.ram);

		// Calculate the maximum number of threads we can allocate in one block.
		// Also keep track of time elapsed for UI stuff.
		const maxThreads = Math.floor(values.maxBlockSize / 1.75);
		const timeElapsed = Date.now() - startTime;

		ns.clearLog();
		ns.print(`${values.target}:`);
		ns.print(` Server Money: \$${ns.formatNumber(money, 2)} / \$${ns.formatNumber(maxMoney, 2)} (${(money / maxMoney * 100).toFixed(2)}%)`);
		ns.print(` Server Security: +${(sec - minSec).toFixed(2)}`);


		// Minimize the security
		if (sec > minSec && !secDone) {
			ns.print(` Prep status: preparing security...`);
			// Calculate how many threads we need to allocate and estimate how many rounds it's going to take.
			const bestThreads = Math.ceil((sec - minSec) * 20) - allocated;
			const wThreads = Math.min(bestThreads, maxThreads);
			const wTime = ns.getWeakenTime(values.target);
			const wEnd = Date.now() + wTime + 100; // Arbitrary buffer added to the end time.
			if (batchCount < 0) {
				batchCount = Math.ceil(bestThreads / maxThreads);
				startTime = Date.now();
			}

			// Allocate as many threads as we can.
			if (wThreads > 0) {
				const metrics = { target: values.target, type: "prepWeaken", time: wTime, end: wEnd, port: 0 };
				for (const block of ramNet) {
					if (block.ram / 1.75 >= wThreads && !block.used) {
						ns.scp("tWeaken.js", block.server);
						ns.exec("tWeaken.js", block.server, wThreads, JSON.stringify(metrics));
						block.used = true;
						allocated += wThreads;
						break;
					}
				}
			}

			// Update the log with time remaining.
			const duration = wTime * batchCount;
			ns.print(` Estimated time remaining: ${ns.tFormat(duration - timeElapsed)}`);

			// If we've run out of threads to allocate, then we resut the allocated threads and wait.
			// If we've allocated all of them, then we just wait to prevent an infinite loop.
			if (maxThreads < 1) {
				allocated = 0;
				await ns.sleep(20);
			} else if (bestThreads < 1) {
				await ns.sleep(20);
			}
			continue;
		}

		// Mark security as done and reset the counters.
		if (!secDone) {
			batchCount = -1;
			startTime = Date.now();
			secDone = true;
			allocated = 0;
		}

		// Max out the money. Mostly the same as security except where noted.
		if (money < maxMoney) {
			ns.print(" Prerun status: maximizing money...")
			const gTime = Math.ceil(ns.getGrowTime(values.target));
			const wTime = Math.ceil(ns.getWeakenTime(values.target));
			// Limit weaken threads to our second best ram server.
			const wMax = ramNet.slice(-2)[0].ram / 1.75;
			const bestThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / money)) - allocated;
			const gThreads = Math.min(bestThreads, maxThreads);
			const wThreads = Math.min(wMax, Math.ceil(ns.growthAnalyzeSecurity(gThreads) / 0.05));

			// Make sure weaken ends after grow.
			const gEnd = Date.now() + wTime + 100;
			const wEnd = Date.now() + wTime + 120;

			if (batchCount < 0) {
				batchCount = Math.ceil(bestThreads / maxThreads);
				startTime = Date.now();
			}
			// Allocate threads if there's room for both.
			if (gThreads > 0 && wThreads > 0) {
				const wMetrics = { target: values.target, type: "prepWeaken", time: wTime, end: wEnd, port: 0 };
				const gMetrics = { target: values.target, type: "prepgrow", time: gTime, end: gEnd, port: 0 };
				let gFound = false;
				let wFound = false;

				// Give weaken the smallest available server it will fit on, then growth.
				for (const block of ramNet) {
					if (block.ram / 1.75 >= wThreads && !block.used && !wFound) {
						ns.scp("tWeaken.js", block.server);
						ns.exec("tWeaken.js", block.server, wThreads, JSON.stringify(wMetrics));
						block.used = true;
						wFound = true;
						if (gFound) break;
					} else if (block.ram / 1.75 >= gThreads && !block.used && !gFound) {
						ns.scp("tGrow.js", block.server);
						ns.exec("tGrow.js", block.server, gThreads, JSON.stringify(gMetrics));
						block.used = true;
						gFound = true;
						allocated += gThreads;
						if (wFound) break;
					}
				}
			}
			const duration = wTime * batchCount;
			ns.print(` Estimated time remaining: ${ns.tFormat(duration - timeElapsed)}`);
			if (maxThreads < 1) {
				allocated = 0;
				await ns.sleep(20);
			} else if (bestThreads < 1) {
				await ns.sleep(20);
			}
			continue;
		}

		// This prep strategy is a little loose the balance of grow/weaken threads, so it doesn't always get it right on the first try.
		if (money < maxMoney || sec > minSec) {
			batchCount = -1;
			secDone = false;
			allocated = 0;
			startTime = Date.now();
			continue;
		}
		break;
	}
}
