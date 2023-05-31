/*
	A pretty big change this time. Well, big for workers anyway. I've tightened up the delay calculations
	to be as perfect as I can get them. Full comments in weaken.js as usual.
*/

/** @param {NS} ns */
export async function main(ns) {
	const start = performance.now();
	const port = ns.getPortHandle(ns.pid);
	const job = JSON.parse(ns.args[0]);
	let tDelay = 0;
	let delay = job.end - job.time - Date.now();
	if (delay < 0) {
		ns.tprint(`WARN: Batch ${job.batch} ${job.type} was ${-delay}ms late. (${job.end})\n`);
		tDelay = -delay
		delay = 0;
	}
	const promise = ns.hack(job.target, { additionalMsec: delay });
	tDelay += performance.now() - start;
	port.write(tDelay);
	await promise;

	ns.atExit(() => {
		const end = Date.now();
		if (job.report) ns.writePort(job.port, job.type + job.batch);
		// Uncomment one of these if you want to log completed jobs. Make sure to uncomment the appropriate lines in the controller as well.
		// ns.tprint(`Batch ${job.batch}: ${job.type} finished at ${end.toString().slice(-6)}/${Math.round(job.end).toString().slice(-6)}\n`);
		// ns.writePort(job.log, `Batch ${job.batch}: ${job.type} finished at ${end.toString().slice(-6)}/${Math.round(job.end + tDelay).toString().slice(-6)}\n`);
	});
}