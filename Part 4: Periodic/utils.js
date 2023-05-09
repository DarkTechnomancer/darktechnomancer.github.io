/*
	We've added a new optimization algorithm, a new module for getServers, and made a few changes to our other
	functions as well.
*/

/** @param {NS} ns */
export async function main(ns) {
	ns.tprint("This is just a function library, it doesn't do anything.");
}

/*
	This version is looking a bit more like our proto-batcher optimization.
	Like the protobatcher, we're brute-forcing max greed for a given constraint.
	The main difference is that the constraint we're finding for is depth (ie. the highest greed
	that can fit our entire minimum depth into RAM).
*/
/** @param {NS} ns */
export function optimizePeriodic(ns, values, ramNet) {
	let maxMoney = ns.getServerMaxMoney(values.target);
	let greed = 0.99;
	while (greed >= 0.01) {
		const amount = maxMoney * greed;
		const hThreads = Math.max(Math.min(Math.floor(ns.hackAnalyzeThreads(values.target, amount)), Math.floor(ramNet.slice(-2)[0].ram / 1.7)), 1);
		const tAmount = ns.hackAnalyze(values.target) * hThreads;
		const gThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * tAmount))) * 1.01);
		const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);

		const batchSize = hThreads + gThreads + wThreads1 + wThreads2;
		const batchCount = values.totalThreads / batchSize;
		if (batchCount >= values.depth) {
			values.greed = greed;
			break;
		}
		greed -= 0.001;
	}
}

/*
Like the similar case in the controller script, this didn't have to be its own function,
but I think it's a bit neater this way. Identical to the above function, except that it uses formulas
to simulate optimal conditions.
*/
/** @param {NS} ns */
export function formsOptimizePeriodic(ns, values, ramNet) {
	const playerSim = ns.getPlayer();
	const serverSim = ns.getServer(values.target);
	let greed = 0.99;
	while (greed >= 0.01) {
		serverSim.hackDifficulty = serverSim.minDifficulty;
		serverSim.moneyAvailable = serverSim.moneyMax;
		const maxMoney = serverSim.moneyMax;
		const hMod = ns.formulas.hacking.hackPercent(serverSim, playerSim);
		const hThreads = Math.max(Math.min(Math.floor((greed / hMod)), Math.floor(ramNet.slice(-2)[0].ram / 1.7)), 1);
		serverSim.moneyAvailable = maxMoney - maxMoney * (hThreads * hMod);
		const gThreads = Math.max(Math.ceil(ns.formulas.hacking.growThreads(serverSim, playerSim, maxMoney) * 1.01), 1);
		const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);

		const batchSize = hThreads + gThreads + wThreads1 + wThreads2;
		const batchCount = values.totalThreads / batchSize;
		if (batchCount >= values.depth) {
			values.greed = greed;
			break;
		}
		greed -= 0.001;
	}
}

// No changes here. Just left it in for posterity.
/** @param {NS} ns */
export function optimizeShotgun(ns, values, ramNet) {
	const wTime = ns.getWeakenTime(values.target);
	let maxMoney = ns.getServerMaxMoney(values.target);
	let greed = 0.01;
	let bestIncome = 0;
	while (greed <= 0.99) {
		// Simulating all of the threads instead of just growth.
		const amount = maxMoney * greed;
		const hThreads = Math.max(Math.min(Math.floor(ns.hackAnalyzeThreads(values.target, amount)), Math.floor(ramNet.slice(-2)[0].ram / 1.7)), 1);
		const tAmount = ns.hackAnalyze(values.target) * hThreads;
		const gThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * tAmount))) * 1.01);
		const wThreads1 = Math.max(Math.ceil(hThreads * 0.002 / 0.05), 1);
		const wThreads2 = Math.max(Math.ceil(gThreads * 0.004 / 0.05), 1);
		const batchSize = hThreads * 1.7 + (gThreads + wThreads1 + wThreads2) * 1.75;
		const batchCount = values.totalThreads * 1.75 / batchSize;
		// This formula is where the magic happens. Trying to balance higher income over longer times.
		const income = tAmount * maxMoney * batchCount / (values.spacer * 4 * batchCount + wTime + values.buffer);
		// Adjusting values. No need to return anything since maps are passed by reference.
		if (income > bestIncome) {
			values.bestIncome = income;
			values.greed = greed;
			values.depth = batchCount;
		}
		greed += 0.001;
	}
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

// Prefab module functions that plug into getServers.
// checkTarget has been adjusted to make use of formulas, if available.
/** @param {NS} ns */
export function checkTarget(ns, server, pVal) {
	const player = ns.getPlayer();
	const serverSim = ns.getServer(server);
	const pSim = ns.getServer(pVal.target);
	let previousScore;
	let currentScore;
	// If we've got formulas, we can factor hack chance in directly rather than using 1/2 required skill as a proxy.
	if (serverSim.requiredHackingSkill <= player.skills.hacking / (pVal.forms ? 1 : 2)) {
		if (pVal.forms) {
			// Here you can see an example of how we clone the target servers, then adjust them to optimal settings.
			serverSim.hackDifficulty = serverSim.minDifficulty;
			pSim.hackDifficulty = pSim.minDifficulty;
			// With formulas we can factor in weaken time and hack chance directly instead of using approximations.
			previousScore = pSim.moneyMax / ns.formulas.hacking.weakenTime(pSim, player) * ns.formulas.hacking.hackChance(pSim, player);
			currentScore = serverSim.moneyMax / ns.formulas.hacking.weakenTime(serverSim, player) * ns.formulas.hacking.hackChance(serverSim, player);
		} else {
			// Even without formulas, we use the server object since we needed it for the formulas version anyway.
			// This is just a very minor optimization on ram cost.
			previousScore = pSim.moneyMax / pSim.minDifficulty;
			currentScore = serverSim.moneyMax / serverSim.minDifficulty;
		}
		if (currentScore > previousScore) pVal.target = server;
	}
}

// Pretty much the same, except I'm not trying to pretend its a predicate anymore.
// That is to say, I've removed the return and started referring to these functions as modules.
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
		}
	}
}

// Another new getServers module. This one just copies a list of scripts onto each server.
/** @param {NS} ns */
export function copyScripts(ns, server, values, overwrite = false) {
	for (const script of values.workers) {
		if ((!ns.fileExists(script, server) || overwrite) && ns.hasRootAccess(server)) {
			ns.scp(script, server);
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
The prep function remains as the same semi-proto-batch mess as before. It's large and annoying to maintain,
so I just haven't bothered adjusting it at all. There are probably far better ways to accomplish this, but I've
been using some variation of this prepping algorithm since day 1. I encourage you to find your own solutions.
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
				const metrics = { batch: "prep", target: values.target, type: "prepWeaken", time: wTime, end: wEnd, port: 0, log: values.log };
				for (const block of ramNet) {
					if (block.ram / 1.75 >= wThreads && !block.used) {
						ns.scp("/part4/tWeaken.js", block.server);
						ns.exec("/part4/tWeaken.js", block.server, wThreads, JSON.stringify(metrics));
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
				const wMetrics = { batch: "prep", target: values.target, type: "prepWeaken", time: wTime, end: wEnd, port: 0, log: values.log };
				const gMetrics = { batch: "prep", target: values.target, type: "prepgrow", time: gTime, end: gEnd, port: 0, log: values.log };
				let gFound = false;
				let wFound = false;

				// Give weaken the smallest available server it will fit on, then growth.
				for (const block of ramNet) {
					if (block.ram / 1.75 >= wThreads && !block.used && !wFound) {
						ns.scp("/part4/tWeaken.js", block.server);
						ns.exec("/part4/tWeaken.js", block.server, wThreads, JSON.stringify(wMetrics));
						block.used = true;
						wFound = true;
						if (gFound) break;
					} else if (block.ram / 1.75 >= gThreads && !block.used && !gFound) {
						ns.scp("/part4/tGrow.js", block.server);
						ns.exec("/part4/tGrow.js", block.server, gThreads, JSON.stringify(gMetrics));
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