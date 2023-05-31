/*
	Very little has changed in the workers. We uncommented a couple of parts to allow for the ping-pong deployment.
	See the tWeaken.js for full comments.
*/

/** @param {NS} ns */
export async function main(ns) {
	const job = JSON.parse(ns.args[0]);

	let delay = job.end - job.time - Date.now();
	if (delay < 0) {
		// We now write back to the controller if jobs are delayed so that it can adjust the other jobs to match.
		ns.tprint(`WARN: Batch ${job.batch} ${job.type} was ${-delay}ms late. (${job.end})\n`);
		ns.writePort(ns.pid, -delay);
		delay = 0;
	} else {
		ns.writePort(ns.pid, 0);
	}
	await ns.weaken(job.target, { additionalMsec: delay });
	const end = Date.now();

	// Write back to let the controller know that we're done. The actual data is currently only used by the prep function.
	ns.atExit(() => {
		if (job.report) ns.writePort(job.port, job.type + job.server);
		ns.tprint(`Batch ${job.batch}: ${job.type} finished at ${end.toString().slice(-6)}/${Math.round(job.end).toString().slice(-6)}\n`);
	});
}