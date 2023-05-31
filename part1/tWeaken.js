/*
	The worker scripts. They don't do a whole lot, and some of the things they are made to do isn't necessary yet.
	Once again, there's some planning ahead involved, plus a couple of bits that are technically only used by
	the prep function. Since they are mostly the same, only tWeaken.js is fully commented.

	Some lines are commented out. Those ones are not used at all in this part.
*/

/** @param {NS} ns */
export async function main(ns) {
	// The only argument is a JSON blob containing the job data. This is a little slow, but fast enough as long as
	// we don't constantly serialize and deserialize the same objects over and over. Once when we send it to the script is fine.
	const job = JSON.parse(ns.args[0]);

	// Calculate the delay required to end at the job's designated time. We do it now for best possible accuracy.
	let delay = job.end - job.time - Date.now();
	if (delay < 0) {
		// Send a warning, but don't actually cancel the job if it's late.
		// The warning isn't sent to the terminal, since it would just get erased. Check logs if jobs land out of order.
		ns.print(`WARN: Batch ${job.batch} ${job.type} was ${-delay}ms too late. (${job.end})\n`);
		// ns.writePort(ns.pid, -delay);
		delay = 0;
	} else {
		// ns.writePort(ns.pid, 0);
	}
	await ns.weaken(job.target, { additionalMsec: delay });
	const end = Date.now();

	// The writePort is just for the prep function for now. Otherwise, we just report to the terminal when we're finished.
	ns.atExit(() => {
		if (job.report) ns.writePort(job.port, job.type + job.server);
		ns.tprint(`Batch ${job.batch}: ${job.type} finished at ${end.toString().slice(-6)}/${Math.round(job.end).toString().slice(-6)}\n`);
	});
}