/*
	A pretty big change this time. Well, big for workers anyway. I've tightened up the delay calculations
	to be as perfect as I can get them. Full comments in weaken.js as usual.
*/

/** @param {NS} ns */
export async function main(ns) {
	const start = performance.now();
	const port = ns.getPortHandle(ns.pid); // We have to define this here. You'll see why in a moment.
	const job = JSON.parse(ns.args[0]);
	let tDelay = 0;
	let delay = job.end - job.time - Date.now();

	// Don't report delay right away.
	if (delay < 0) {
		ns.tprint(`WARN: Batch ${job.batch} ${job.type} was ${-delay}ms late. (${job.end})\n`);
		tDelay = -delay
		delay = 0;
	}

	// The actual function call can take some time, so instead of awaiting on it right away, we save the promise for later.
	const promise = ns.weaken(job.target, { additionalMsec: delay });

	// Then after calling the hack function, we calculate our final delay and report it to the controller.
	tDelay += performance.now() - start;

	// The ns object is tied up by the promise, so invoking it now would cause a concurrency error.
	// That's why we fetched this handle earlier.
	port.write(tDelay);

	// Then we finally await the promise. This should give millisecond-accurate predictions for the end time of a job.
	await promise;

	ns.atExit(() => {
		const end = Date.now();
		if (job.report) ns.writePort(job.port, job.type + job.batch);
		// Uncomment one of these if you want to log completed jobs. Make sure to uncomment the appropriate lines in the controller as well.
		// ns.tprint(`Batch ${job.batch}: ${job.type} finished at ${end.toString().slice(-6)}/${Math.round(job.end).toString().slice(-6)}\n`);
		// ns.writePort(job.log, `Batch ${job.batch}: ${job.type} finished at ${end.toString().slice(-6)}/${Math.round(job.end + tDelay).toString().slice(-6)}\n`);
	});
}