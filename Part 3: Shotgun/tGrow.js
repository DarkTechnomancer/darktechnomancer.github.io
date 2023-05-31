/*
	Workers are mostly the same, aside from uncommented portions allowing the hack and grow workers to report.
	I've also generally commented out the terminal logging, as it gets rather laggy when there's a lot of scripts
	writing to terminal.
*/

/** @param {NS} ns */
export async function main(ns) {
	const job = JSON.parse(ns.args[0]);
	let delay = job.end - job.time - Date.now();
	if (delay < 0) {
		ns.tprint(`WARN: Batch ${job.batch} ${job.type} was ${-delay}ms late. (${job.end})\n`);
		ns.writePort(ns.pid, -delay);
		delay = 0;
	} else {
		ns.writePort(ns.pid, 0);
	}
	await ns.grow(job.target, { additionalMsec: delay });
	const end = Date.now();
	ns.atExit(() => {
		if (job.report) ns.writePort(job.port, job.type + job.server);
		// ns.tprint(`Batch ${job.batch}: ${job.type} finished at ${end.toString().slice(-6)}/${Math.round(job.end).toString().slice(-6)}\n`);
	});
}