/*
  The utility function library. The purpose of this library is to give a place for the sorts of functions
  that will often be used by multiple different scripts. This way we don't need to keep copying them.
 */

/** @param {NS} ns */
export async function main(ns) {
	ns.tprint("This is just a function library, it doesn't do anything.");
}

// The recursive server navigation algorithm. The lambda predicate determines which servers to add to the final list.
// You can also plug other functions into the lambda to perform other tasks that check all servers at the same time.
/** @param {NS} ns */
export function getServers(ns, lambdaCondition = () => true, hostname = "home", servers = [], visited = []) {
	if (visited.includes(hostname)) return;
	visited.push(hostname);
	if (lambdaCondition(hostname)) servers.push(hostname);
	const connectedNodes = ns.scan(hostname);
	if (hostname !== "home") connectedNodes.shift();
	for (const node of connectedNodes) getServers(ns, lambdaCondition, node, servers, visited);
	return servers;
}

// Here are a couple of my own getServers modules.
// This one finds the best target for hacking. It tries to balance expected return with time taken.
/** @param {NS} ns */
export function checkTarget(ns, server, target = "n00dles", forms = false) {
	if (!ns.hasRootAccess(server)) return target;
	const player = ns.getPlayer();
	const serverSim = ns.getServer(server);
	const pSim = ns.getServer(target);
	let previousScore;
	let currentScore;
	// If we've got formulas, we can factor hack chance in directly rather than using 1/2 required skill as a proxy.
	if (serverSim.requiredHackingSkill <= player.skills.hacking / (forms ? 1 : 2)) {
		if (forms) {
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
		if (currentScore > previousScore) target = server;
	}
	return target;
}

// A simple function for copying a list of scripts to a server.
/** @param {NS} ns */
export function copyScripts(ns, server, scripts, overwrite = false) {
	for (const script of scripts) {
		if ((!ns.fileExists(script, server) || overwrite) && ns.hasRootAccess(server)) {
			ns.scp(script, server);
		}
	}
}

// A generic function to check that a given server is prepped. Mostly just a convenience.
export function isPrepped(ns, server) {
	const tolerance = 0.0001;
	const maxMoney = ns.getServerMaxMoney(server);
	const money = ns.getServerMoneyAvailable(server);
	const minSec = ns.getServerMinSecurityLevel(server);
	const sec = ns.getServerSecurityLevel(server);
	const secFix = Math.abs(sec - minSec) < tolerance; // A fix for floating point innaccuracy.
	return (money === maxMoney && secFix) ? true : false;
}

/*
	This prep function isn't part of the tutorial, but the rest of the code wouldn't work without it.
	I don't make any guarantees, but I've been using it and it's worked well enough. I'll comment it anyway.
	The prep strategy uses a modified proto-batching technique, which will be covered in part 2.
*/
/** @param {NS} ns */
export async function prep(ns, values, ramNet) {
	const maxMoney = values.maxMoney;
	const minSec = values.minSec;
	let money = values.money;
	let sec = values.sec;
	while (!isPrepped(ns, values.target)) {
		const wTime = ns.getWeakenTime(values.target);
		const gTime = wTime * 0.8;
		const dataPort = ns.getPortHandle(ns.pid);
		dataPort.clear();

		const pRam = ramNet.cloneBlocks();
		const maxThreads = Math.floor(ramNet.maxBlockSize / 1.75);
		const totalThreads = ramNet.prepThreads;
		let wThreads1 = 0;
		let wThreads2 = 0;
		let gThreads = 0;
		let batchCount = 1;
		let script, mode;
		/*
		Modes:
		0: Security only
		1: Money only
		2: One shot
		*/

		if (money < maxMoney) {
			gThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / money));
			wThreads2 = Math.ceil(ns.growthAnalyzeSecurity(gThreads) / 0.05);
		}
		if (sec > minSec) {
			wThreads1 = Math.ceil((sec - minSec) * 20);
			if (!(wThreads1 + wThreads2 + gThreads <= totalThreads && gThreads <= maxThreads)) {
				gThreads = 0;
				wThreads2 = 0;
				batchCount = Math.ceil(wThreads1 / totalThreads);
				if (batchCount > 1) wThreads1 = totalThreads;
				mode = 0;
			} else mode = 2;
		} else if (gThreads > maxThreads || gThreads + wThreads2 > totalThreads) {
			mode = 1;
			const oldG = gThreads;
			wThreads2 = Math.max(Math.floor(totalThreads / 13.5), 1);
			gThreads = Math.floor(wThreads2 * 12.5);
			batchCount = Math.ceil(oldG / gThreads);
		} else mode = 2;

		// Big buffer here, since all the previous calculations can take a while. One second should be more than enough.
		const wEnd1 = Date.now() + wTime + 1000;
		const gEnd = wEnd1 + values.spacer;
		const wEnd2 = gEnd + values.spacer;

		// "metrics" here is basically a mock Job object. Again, this is just an artifact of repurposed old code.
		const metrics = {
			batch: "prep",
			target: values.target,
			type: "none",
			time: 0,
			end: 0,
			port: ns.pid,
			log: values.log,
			report: false
		};

		// Actually assigning threads. We actually allow grow threads to be spread out in mode 1.
		// This is because we don't mind if the effect is a bit reduced from higher security unlike a normal batcher.
		// We're not trying to grow a specific amount, we're trying to grow as much as possible.
		for (const block of pRam) {
			while (block.ram >= 1.75) {
				const bMax = Math.floor(block.ram / 1.75)
				let threads = 0;
				if (wThreads1 > 0) {
					script = "/part1/tWeaken.js";
					metrics.type = "pWeaken1";
					metrics.time = wTime;
					metrics.end = wEnd1;
					threads = Math.min(wThreads1, bMax);
					if (wThreads2 === 0 && wThreads1 - threads <= 0) metrics.report = true;
					wThreads1 -= threads;
				} else if (wThreads2 > 0) {
					script = "/part1/tWeaken.js";
					metrics.type = "pWeaken2";
					metrics.time = wTime;
					metrics.end = wEnd2;
					threads = Math.min(wThreads2, bMax);
					if (wThreads2 - threads === 0) metrics.report = true;
					wThreads2 -= threads;
				} else if (gThreads > 0 && mode === 1) {
					script = "/part1/tGrow.js";
					metrics.type = "pGrow";
					metrics.time = gTime;
					metrics.end = gEnd;
					threads = Math.min(gThreads, bMax);
					metrics.report = false;
					gThreads -= threads;
				} else if (gThreads > 0 && bMax >= gThreads) {
					script = "/part1/tGrow.js";
					metrics.type = "pGrow";
					metrics.time = gTime;
					metrics.end = gEnd;
					threads = gThreads;
					metrics.report = false;
					gThreads = 0;
				} else break;
				metrics.server = block.server;
				const pid = ns.exec(script, block.server, threads, JSON.stringify(metrics));
				if (!pid) throw new Error("Unable to assign all jobs.");
				block.ram -= 1.75 * threads;
			}
		}

		// Fancy UI stuff to update you on progress.
		const tEnd = ((mode === 0 ? wEnd1 : wEnd2) - Date.now()) * batchCount + Date.now();
		const timer = setInterval(() => {
			ns.clearLog();
			switch (mode) {
				case 0:
					ns.print(`Weakening security on ${values.target}...`);
					break;
				case 1:
					ns.print(`Maximizing money on ${values.target}...`);
					break;
				case 2:
					ns.print(`Finalizing preparation on ${values.target}...`);
			}
			ns.print(`Security: +${ns.formatNumber(sec - minSec, 3)}`);
			ns.print(`Money: \$${ns.formatNumber(money, 2)}/${ns.formatNumber(maxMoney, 2)}`);
			const time = tEnd - Date.now();
			ns.print(`Estimated time remaining: ${ns.tFormat(time)}`);
			ns.print(`~${batchCount} ${(batchCount === 1) ? "batch" : "batches"}.`);
		}, 200);
		ns.atExit(() => clearInterval(timer));

		// Wait for the last weaken to finish.
		do await dataPort.nextWrite(); while (!dataPort.read().startsWith("pWeaken"));
		clearInterval(timer);
		await ns.sleep(100);

		money = ns.getServerMoneyAvailable(values.target);
		sec = ns.getServerSecurityLevel(values.target);
	}
	return true;
}
