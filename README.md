
## A Beginner's Guide to Batching
When I say beginner, I really mean it. I am a beginner myself, and this guide is written specifically with the things I wish I'd known before I started in mind. What I seek to do with this guide is to lay out the basic principles of a batcher, the tools available, and some of the common pitfalls to avoid.
### Glossary of Terms
There's a lot of jargon that gets thrown around that can be confusing to beginners, so I'll try to define some of the commonly used terms here.

- **Prep/Prepped**: A server is "prepped" when its security as at the minimum and it's money is at the maximum. This is the ideal state for hacking.
- **Task**: A Hack, Grow, or Weaken command run through a script. Generally shortened to H/G/W.
 - **Batch**: A "batch" is a series of H/G/W tasks running in parallel such that they will end in a specific order right after each other, returning the server back to a prepped state when they resolve.
 - **HGW**: A batch that consists of a Hack, followed by a Grow, and then finally a Weaken. This type of batch is faster to complete and less error prone, but requires more RAM and very particular calculations (requiring either Formulas.exe or very inefficient overestimations).
 - **HWGW**: The most common type of batch. Consists of a Hack, then a Weaken, then a Grow, then finally a second Weaken to bring the server back to a prepped state. This guide will focus almost exclusively on HWGW.
 - **Program/Script**: My own distinction: A script is a single .js file, while a program may involve several scripts working together.
 - **Proto-batcher**: A program which runs one batch at a time, waiting for it to finish before launching another.
 - **Batcher**: A program which runs several batches in parallel, ideally running a constant stream of tasks with fixed intervals between them for an indefinite period of time. This is what we're here for.
 - **Controller**: A script that's responsible for managing other scripts. The "brain" of a batcher.
 - **Worker**: A script that performs H/G/W tasks. You generally want these as lean as possible, ideally costing no more ram than the base cost plus the cost of the task.
 - **Desync**: When something causes the H/G/W tasks to either happen out of order or fail to perform correctly, the batcher is "desynced."
 - **Collision**: A specific kind of desync caused by an task starting when another one ends, leading to unpredictable server conditions and potential desync.
 - **Collision Wall**: A bit outdated, but I'll mention it here anyway. The collision wall is the point at which the environment is so saturated by tasks that collisions are almost guaranteed without very precisely controlled task start/end times.
 - **Overestimation**: Another me-specific term. When I say this, I'm referring to intentionally padding thread counts beyond the minimum necessary, usually as protection against desyncs.
 - **Port**: Not to be confused with the ports that need to be opened to gain root access on servers, netscript ports are a special tool that allows active scripts to communicate with each other. More on this later.
 - **Shotgun**: A scheduling method that runs every single batch at once. Very RAM intensive. Can trigger the infinite loop protection if you aren't careful. Basically a proto-batcher on steroids.
 - **Continuous**: Batchers that run at a steady rate. Basically, not a shotgun.
 - **Periodic**: A continuous scheduling method that deploys entire batches at set intervals.
 - **JIT/Just-In-Time**: A continuous scheduling method that deploys jobs individually, as close to the latest possible moment as is practical/feasible.
 
### Where to Begin
It can be a pretty daunting task to make a batcher. There are a lot of factors that interact with each other, some of which are obvious and easy to predict, some of which are impossible to anticipate without forewarning or intimate knowledge of the inner workings of the game. For now, let's just take things one step at a time. First a checklist of things you need (and a few special mentions regarding things you *don't* need). Based loosely on a helpful discord message from Thatman:
#### Things you need:
 - [ ] A way to compile a list of all servers with ram and root access
       (and to gain root access if possible).
 - [ ] A good target for hacking
 - [ ] A way to prep targets
 - [ ] A function for measuring and allocating ram for workers.
 - [ ] Worker scripts (more details on these later)
 - [ ] Error handling and logging (put checks in place so that if things go wrong, the program halts and tells you exactly what happened).

#### Things you DON'T need:
- Formulas.exe (seriously, there's enough confusion about this I'm gonna give it its own section)
- A math PhD. While there's some arithmetic involved, complex math formulas and equations are not necessary to get a batcher working ~~anymore~~.
- To do everything at once. Try to solve one problem at a time.
- To be perfect. Ultimately, this is an incremental game, and it's not the end of the world if things take a bit longer.

For the most part, these things are beyond the scope of this guide. I'll leave it to you to figure out how to solve the prerequisites, but I will leave a few comments:

For the purposes of this game, a depth-first recursive algorithm is probably the best way to traverse the server list. If you don't know what that means, just look it up, it's not too difficult.

Without formulas, a common de facto algorithm (credit to discord user xsinx) for finding the best server to target is to pare the list down to only servers with a hacking requirement of half your level, then divide their max money by the time it takes to weaken it once. Pick whichever server scores highest. (For a fully functional batcher, you don't need to do that division, but if you had one of those you wouldn't be reading this.)

When allocating RAM, you might be tempted to distribute an task with very high thread counts across multiple servers. **Don't**. This will cause your batcher to underperform due to security increases and throw off your calculations, causing desyncs. Make sure each task in a batch fits on a single server (you can distribute the batch across different servers, though). Note: Technically this doesn't apply to weaken, but it tends to have the lowest thread counts anyway, and it could mess up timing. Don't tempt fate.

### What's the deal with Formulas?
Formulas.exe, aka the formulas API, is a powerful tool that allows you to do calculations with player and server objects (among a variety of other things that aren't relevant to this guide). **None of these functions are necessary for making a batcher.** Whether it's threadcounts, timing, desyncs, or even keeping your batcher running after a levelup happens, you do not *need* formulas.
#### What Formulas.exe *is* good for:
- Finding a target: You can use formulas to check how long a weaken would take without having to prep it first.
- HGW: Calculating how many grow threads are needed after a hack without weakening first is tricky without formulas, and requires major overestimation otherwise.
- Seamless level transitions: A fancy optimization that recalculates thread counts in advance of a level up without overestimation.
- Unit testing: Want to check your math? With formulas you can set up simulated environments to test functions without having to wait for task times. Very useful for quickly debugging potential problems and checking your logic. Not useful for timing/scheduling, unfortunately.
- More accurate calculation for Grow threads (more on that in the next section).

### Tools of the trade
There are a lot of functions that go into making a good batcher, many of which you have to write yourself, but I'll cover the most important prefab functions here:

*Note: All non-formulas functions use the state of the player and server at the moment of the function call. Any applicable multipliers are automatically factored in.*
#### Timing functions:

    ns.getHackTime(server);
    ns.getGrowTime(server);
    ns.getWeakenTime(server);
    
These functions will give you the amount of time in milliseconds it will take to complete a given task on the server provided by the argument. It uses the current state of both the player and server at the time when the function is called, so make sure you prep your servers before calculating.

Strictly speaking, you only actually need to use one of these, as their times are always consistent relative to each other. At the time of writing, the ratios between them are 1 weaken = 4 hacks = 3.2 grows.

    Date.now();
    performance.now();
    ns.getTimeSinceLastAug();
    
These functions all give some variation of the current time in milliseconds. I'd recommend against using getTimeSinceLastAug, but the other two are both valid.

    const startTime = Date.now();
    const endTime = Date.now() + ns.getWeakenTime();
    timeElapsed = Date.now() - startTime;
    
Some examples of ways to use the timing functions.

    await sleep(ms);
    await port.nextWrite();
    
These are functions used to wait for a period of time before executing more code. Sleep is simple enough, you just wait for a predefined number of milliseconds. I'll cover nextWrite in more detail when I talk about ports.

    await  ns.grow(server,  {additionalMsec:  ms});
    
The key aspect here is `additionalMsec`. The H/G/W functions can take an extra optional argument called "opts" which has three special options that modify the behavior. It has to be a dictionary (hence the {} braces surrounding the argument) and the options are `additionalMsec`, `stock`, and `threads`. We'll ignore `stock` for now and just look at the other two. `threads` lets you tell the task to use fewer threads than the script running it. What for? I don't know. Moving on. `additionalMsec` lets you add a number of milliseconds as a delay, forcing the task to take that much longer.

This has two advantages: First, additionalMsec is much more predictable than sleep, I won't get into why since it involves some of the deeper code stuff that defines game behavior, but just take my word for it. Second, it means that it will use the state of the server the moment the script is run, instead of checking after sleeping for a delay. This is *huge* for avoiding collisions, as it gives you much finer control over when an task starts and ends.
#### Thread functions

    ns.hackAnalyze(target);
    ns.hackAnalyzeThreads(target, amount);
    ns.growthAnalyze(target, multipier);
    
From the top:
- hackAnalyze gives you the amount of money stolen by a single thread.
- hackAnalyzeThreads gives you the number of threads required to steal a *specific* amount of money from the server.
- growthAnalyze is the most complicated of the lot, and returns the approximate number of threads it would take to multiply the money in the server by the given value. For example, if you give it 2, then it tells you how many threads it takes to double the money on the server, 3 for triple, and so on.

You'll note that I said "approximate." That's probably throwing up some red flags, so I'll explain: growthAnalyze has some eccentricities. Each grow task actually adds $1 per thread and *then* multiplies, and since the server will be at max money when we do the calculations, this can result in underestimated thread counts if the server funds get extremely low. For practical purposes, this is almost always going to be good enough, but if you want better accuracy, there is an alternative in the Formulas API:

    ns.formulas.hacking.growThreads(server, player, targetValue);
This function will give you the number of threads required to take a server from its current value up to a target (usually its moneyMax value). This is much better, but requires some setup (and formulas), it takes a server object, not a hostname, which you can get from `ns.getServer(hostname)` and a player object `ns.getPlayer()`. You'll need to make sure that the simulated server has its funds set to the exact amount that you expect a hack to put it to (not just the amount you're *trying* to take.

That brings me to the `hackAnalyze` and `hackAnalyzeThreads` functions. When you run `hackAnalyzeThreads` it will give you the decimal-accurate number of threads required to steal that much money, but you can only assign an integer number of threads to a job. Generally, you can just floor the value and use it as is, but if you want to be more precise, you can then run that number through `hackAnalyze` to get the true value that you're stealing from the server.
#### Security functions
You might have noticed that I never mentioned weaken while talking about threads, well this is why. It gets it own section. Honestly, the fact is that security is *very* simple compared to the other aspects. If you want to scrimp and save on RAM, you can even ignore the functions entirely and just use some simple arithmetic:

    Security increase per hack thread__: 0.002
    Security increase per grow thread__: 0.004
    Security decrease per weaken thread: 0.05
    
That's it. It's all flat values. One weaken will counteract 25 hacks or 12.5 grows. However, if you don't feel like doing the arithmetic, there are functions:

    ns.hackAnalyzeSecurity(threads, target);
    ns.growthAnalyzeSecurity(threads, target);
    
It's a waste of RAM to use them, but I've included them here for completeness and because that waste really is trivial.

    weakenAnalyze(threads, cores);
    
Okay, so actually there is a special case. When running weaken from your home console, the effectiveness is improved by cores. In that case, you'll want to use this to determine the number of threads, but just remember that you should only factor in cores if you *know* that your tasks are going to be executed there.

#### Formulas functions
While it's not strictly necessary, Formulas.exe *is* incredibly powerful, and so I'll take a moment to quickly go over the most relevant functions and what they can do for you. Aside from the `growThreads` already mentioned there's:

    ns.formulas.hacking.hackTime(server, player);
    ns.formulas.hacking.growTime(server, player);
    ns.formulas.hacking.weakenTime(server, player);
    ns.formulas.hacking.hackPercent(server, player);
    ns.formulas.hacking.hackChance(server, player);
    ns.formulas.hacking.hackExp(server, player);
    
You'll note that these are all just things that the previous functions could already do. The only difference is that you can tweak the values of the server and player objects to simulate a particular environment. There's also `growPercent` but it's a bit of a weird one, and I don't know how to use it properly, so I'll leave it aside.

An important addition to these is the SkillsFormulas interface, which consists of only two functions, but they are powerful ones:

    calculateExp(skill, skillMult);
    calculateSkill(exp, skillMult);
    
These can be used to calculate what skill level a certain amount of exp is worth, and how much exp is required to reach a skill respectively. Note that the `calculateExp` function actually returns one exp less than the exact amount required to reach a level due to a rounding error. These are integral for smooth and efficient solutions to leveling up during a batcher's task. There are non-formulas ways to deal with it, but they generally involve overestimation and/or damage control.
#### Ports
It's usually a good idea to have your controller and workers communicate with each other, and ports are the way to do it. A port is created with the function

    port = ns.getPortHandle(int);
    
As far as I know, any integer works and there's no upper bound to how many ports you can have (other than whatever size integer is used to store them). It's up to you how you want to handle them, but I'd recommend unique identifiers. There are a few ways to do this, but the PID of the controller is usually a good start.

Now, how do you actually use the things? Here are the relevant functions:

    port.peek();
    port.read();
    port.write(value);
    port.tryWrite(value);
    
`peek` and `read` will get the first (oldest) element in the port, or the string "NULL PORT DATA" if the port is empty. The difference is that `peek` will leave the element in place, while `read` is destructive and will remove the element from the port.
   
`write` and `tryWrite` are essentially the same, except that `tryWrite` will only write to the port if it's not full (the maximum number of elements in a port is a setting in game) while `write` will just shove its value onto the stack, bumping off the oldest element in the process. Note that `write` will actually return the item it displaced, which can be potentially useful, but is beyond the scope of this guide.

In addition, there are a few more useful functions for handling ports:

    port.clear();
    port.empty();
    port.full();
    port.nextWrite();

`empty` and `full` are simple enough—they just check if the port is empty or full respectively. `clear` empties the entire queue, and it's generally good practice to have your controller script do this when it starts up, as ports are not emptied when the scripts that create them die.

`nextWrite` is where the magic happens. Due to some javascript arcana that I do not personally understand well enough to get into, `nextWrite` guarantees that the code listening to the port will go next after the code that writes to it. This is extremely useful for timing purposes compared to `sleep`, which could allow any number of processes to be inserted between writing to and reading from the port.

There are some limitations. Ports can only traffic numbers and strings, they can only hold a certain number of values at a time (controlled by an in-game setting), and each one must have a unique identifier, which can make things difficult if you want to run multiple scripts each using multiple ports without risk of collision. Most of these you just have to live with, but one is actually very easily solved.

You can transfer any data object from one script to another using serialization:

    JSON.stringify(object);
    JSON.parse(string);

These functions allow you to encode an object into a specially formatted string, transfer it over a port, then decode that string back into an object on the other side. This is very useful for transmitting large quantities of data through a port without clogging it up.

### Putting it all together (AKA the good part)
This is the part you're really here for. Let's be honest, you either skimmed everything up to this point or just scrolled down and skipped it entirely, but that's fine. If you get stuck, you may find some useful answers above, but for now, let's talk about what an actual batcher looks like, and how to build one.

We're going to start small, and gradually work our way up. Most of this is going to be plain language or pseudocode rather than actual code snippets. If you're here to copy a script out of the box, look elsewhere, but if you're interested in actually understanding the principles behind it and solving the ever-expanding puzzle of making that number go up for yourself, then read on. That said, I will be expanding this page with code examples for each part later.
#### Baby Steps: Making an actual batch
That's batch. Singular. We need to walk before we can run, but don't worry—even the first few steps of this process will leave you with scripts far more efficient than the basic hacking template from the tutorial.

To begin, let's talk about the anatomy of a controller and a worker. The controller is the brain, and where most of your logic will go, while the workers are the arms and legs. Let's briefly go over what each one needs to do in this step.

**The controller** needs to be able to spawn workers. It needs to know when workers are supposed to spawn, how many threads to run them with, and in what order.

**The workers**, aside from the obvious job of running their designated tasks, should also be able to start with a delay, either through sleep or additionalMsec. At this point, I'm going to highly recommend some sort of communal logging system that all workers can write to. A monitor script or a txt log file are both valid options for this.

Remember: H/G/W tasks calculate their effects when they finish.

Let's consider this step passed when you can write a script that consistently deploys a HWGW batch such that each job finishes in the correct order and within 20ms of each other and successfully returns the server to a prepped state. Establishing how you *know* you've passed is a crucial part of this step, and should not be overlooked.

You can find commented code examples of this step in [Part 1](https://github.com/DarkTechnomancer/darktechnomancer.github.io/tree/main/Part%201:%20A%20Batch) but I highly encourage you to try figuring it out on your own.

#### Communication: Making your first proto-batcher
This is an even smaller step than the last one, but no less important. Now that you're able to deploy a batch, you're going to want to continuously deploy batches. This requires some extra functionality from our program:

**The controller** must know when a batch finishes so that it can deploy the next one. Maybe you've already figured this part out as part of the previous step, in which case good job. If not, read on.

**The worker** doesn't have a whole lot going on in its life yet, but maybe we can make it a bit more exciting. A way of telling the controller that it's finished is a good start.

You might have guessed from the header, but I'm going to highly recommend getting your controller and workers to start talking to each other if they weren't already. There are a few major advantages to this: First, it turns out that a surprising amount can happen between when a script is deployed and when it starts actually running its code. By passing the time it's expected to end, and how long it's meant to run as arguments, you can have it calculate its *own* delay at no additional RAM cost.

Second, as mentioned in the earlier section discussing `nextWrite`, it gives us much more precise timing control over what happens when a script finishes. Also, good communication between controller and workers will make it much easier in the future for you to detect and troubleshoot errors.

Your goals for this step are:
1) Tighten the gap between tasks to only 5ms.
2) Start a new batch within 5ms of the previous one
3) Have your tasks ending within 1-2ms of when they are supposed to.
4) Automatically recalculate threads and timing after a level up.

(Note: If you've got a slower computer, you can raise the gap 10 or 20ms, but it really should be quite easy. Landing times are non-negotiable, since I've literally told you exactly how to do that, and it shouldn't be impacted by performance.)

Code examples: [Part 2](https://github.com/DarkTechnomancer/darktechnomancer.github.io/tree/main/Part%202:%20Proto-Batcher)

#### Branching Out: Don't let perfect get in the way of good enough
At this point, you can strongly consider just moving on. Batching is a cool problem, but it's not a necessity. It's only one part of a much bigger game. A proto-batcher is already quite good, and while you could spend hours, days, or weeks fine-tuning it into the perfect money-printing machine, you could also just point it at the top 10-20 servers and have it loot 50% of their funds at a time on an infinite loop and just call it good.

There's no real goal here, this is just an interlude before we finally get to the real deal. Try it, though. Set the greed level to 80% and just throw it at whatever's good. omega-net, rho-construction, phantasy...just see how much you can get by dedicating as much ram as you can towards looting the world with your proto-batcher.

Actually, I take it back. There is a goal for this step: make sure your controllers don't step on each other's toes. No colliding ports, no sniping ram from each other, no listening to the wrong workers. Make sure you can run like ten of these bad boys in parallel before moving on to the final (and largest) step.

(Optional): For bonus points, try making a super-controller that controls and coordinates between your controller scripts.

#### So Then I Started Blasting: The shotgun batcher
Based on the lessons so far, it should be pretty easy. A shotgun batcher is like a proto-batcher's bigger, roided up cousin. Essentially this strategy fills ram up with as many batches as possible against a single target. In fact, if you think about it, shotgun batchers don't actually deploy multiple batches at all, but rather one enormous super-batch. Rather than HWGW, a shotgun batch is HWGWHWGWHWGWHWGWHWGWHWGWHWGW...etc.

The logic is pretty simple:

**The controller**, must figure out how big of a super-batch it fit into the available ram on the network, then deploy the entire thing in one go. Once the super-batch is finished, check on the server and either re-prep or fire off another blast.

**The worker,** still needs to know when it's supposed to end. Since we're dropping everything at once, it's very important that we don't mess up the synchronization. One advantage is that as long as the end times are accurate, lag delays will delay the entire batch equally, so things will always land in the right order, provided they were already going to. We also need to make sure that the last worker knows that it's the last one and can communicate back to the controller that it's finished. Don't rely on sleeps for this, since delays are quite likely on batches this large.

**Potential problems**: Once the shotgun has been fired, you have limited control over what the workers are doing. If you level up during the execution of the super-batch, the workers are still stuck with the same numbers they had when you pulled the trigger. You can mitigate the effects of this by overestimating grow threads, but this is already a highly RAM-heavy approach.

Another issue is that if you have lots and lots of RAM, the process of firing the shotgun can take...a while. Long enough that it might even trigger the game's infinite loop detection. This can also cause your first set of workers to land too late for their expected end times, either cancelling or simply crashing due to negative offsets (depending on whether you've already prepared for this case).

There are ways around this, such as using formulas to predict when you need to change threads, cancelling active jobs on a level up, or overestimating the number of grow threads required, but ultimately I'll leave those solutions to you.

Goals:
1) Fire off a shotgun batch using all available RAM that executes without any timing or security desyncs (running out of money is forgivable in the case of level ups)
2) Get the controller to redeploy after it hears back from the final worker.
3) (Optional) Using lessons from the previous step, write a super-controller that manages two servers at once, prepping one while it shotguns the other, then switching between the two as needed for maximum uptime.

### The Final Chapter: Continuous Batchers
This section gets the big header. Continuous batchers are a sudden and significant leap in terms of complexity and difficulty. If you've followed the guide up to this point and actually accomplished all the goals, you'll have a big head start, but it's still a very daunting task. There's no simple progression here—it's just a matter of picking a design that works for you, and building it up until you're satisfied.

First, let's talk a bit about the different design architectures for continuous batchers that I'm aware of:

#### Periodic
A term coined by discord user stalefish, who wrote an incredible algorithm that calculated a safe window where an entire batch of workers could be deployed without causing any collision. This was before `additionalMsec` and `nextWrite` were available, and workers had to rely on sleep for their delays. Nowadays, his algorithm isn't so useful, but the principles behind it still apply.

The logic is essentially this: you want to deploy batches periodically, at a set interval which has been calculated to always be safe. Even with `additionalMsec`, stalefish's algorithm still works, and you can actually modify it by trimming out a lot of the accommodations it made for the different durations of H/G/W tasks. If the timing is good for a weaken, it's good for the rest of them too thanks to `additionalMsec`.

But thanks to `nextWrite` you don't even have to do that. We have a way to know *exactly* when it's safe to deploy a new batch: whenever a worker carrying a weaken task finishes! Well, whenever *one* of the weakens finishes. If you deployed every time either of them finished, you'd end up with too many simultaneous batches and cause collisions.

Generally, you can expect to be able to run a number of parallel batches (or depth) based on the space between tasks, and the time it takes to perform a weaken task: `weakenTime / (4 * spacer) = depth`

Once you have that, it's just a matter of seeding the initial queue and then keeping the whole thing running. If you've followed up to this point, I should even have to tell you what's required from your workers and controllers, but I'll write it down for old-times sake:

**Controller** needs to calculate the appropriate depth, deploy initial batches, then redeploy a new batch each time one finishes. This is essentially just our proto-batcher strategy improved to juggle multiple batches at once.

**Workers** are thus pretty much identical to proto-batcher workers. They just need to ensure that they finish when they're supposed to, and tell the controller when they're done.

Goals:
1) Write a batcher that can run continuously without desyncing until the player levels up.

That 's it. Trust me, it's easier said that done, even with everything you've done so far.

#### JIT/Just-in-Time
These are the most complicated of the lot, but they have a lot of major advantages over other designs:

**Pros**:

- RAM efficiency: a JIT batcher uses only the bare minimum amount of ram, avoiding waste by scheduling jobs only when they are needed.
- Pure logic: most JIT approaches don't need to use any algorithms or formulas to determine when to schedule jobs. You know when the job needs to end, you know the minimum amount of time it needs to run, and you know when you can safely deploy jobs. With only that information, you can determine whether or not a worker needs to be deployed.
- Flexible: By waiting until the last moment to deploy a job, your program will be much more resilient against outside factors like lag or player levels. A JIT batcher is capable of modifying its queue on the fly to account for changes in environment, or even cancelling jobs outright if it has reason to think they will fail.

**Cons:**

- Complex: JIT batchers have *a lot* of moving parts, and debugging them can be a real nightmare.
- Marginal: Compared to a periodic batcher, a JIT only has slightly better efficiency for how much more difficult it is to implement.
- Fragile: This might seem like a contradiction to the previous point about being flexible, but as resilient as JIT structures are to outside factors (when properly prepared for them), their intricate designs mean that they are extremely fragile to user error. One small mistake in your logic can cause a sweeping cascade failure that could be very hard to replicate and identify.

I'm not going to go into high detail on how to accomplish this. If you've made it this far, you should have all the tools you need, but just know that you also don't *need* to go any further. Regardless, here are a few things you should prepare to accomplish to make your JIT batcher work:

**The controller** needs to maintain a schedule of jobs waiting to be deployed, usually in some sort of queue. You need to know when a job is supposed to end, and what the latest you can afford to deploy it is. It may also help to keep track of which jobs are *active* so that you can allow your logic to account for delays and match queued jobs to active ones in the same batch. You need to schedule new jobs in the queue as old ones execute, so that you're always maintaining a list of jobs waiting to be deployed.

**Workers** must execute their jobs on time. This is crucial since you aren't deploying all the jobs from a batch all at once. Since you're slotting the shorter jobs in between the longer ones as you go, it's imperative that execution times are calculated as accurately as possible, and that any *inaccuracies* are reported and accounted for.

One option that can help here is permanent Weaken workers. This has the disadvantage of being very static unless the workers are able to receive new parameters from the controller, but since the number of active weaken jobs should theoretically always remain constant, it saves you the trouble of having to redeploy them and keeps your timing very consistent as long as the workers stay in sync with each other.

Goals:
1) Run a continuous batcher that uses less ram to get the same money over time as an equivalent periodic batcher.

Once again, that's it. Easier said than done. My own JIT batcher uses a huge buffer to prevent desyncs that causes it to actually take *more* RAM than a periodic batcher. It's a work in progress, but if you've bothered to read this far then I think you're main lesson should be that it's *always* a work in progress.

### "Now What?": Looking into the future
At this point, there's nothing really left for me to say. This is as far as I've personally gotten, and it's been a heck of a journey getting here. Hopefully, by writing this, I can help a few other beginners like me a steadier path towards their first functional batchers. I know I was pretty happy when I finally got mine to work.

Here are a few final optimizations that you can consider working on once you've managed to accomplish everything written above:
#### Final Goals:
- Handle levelups: I talked a bit about stuff like formulas, overestimation, and recalculation, but it's a deep enough subject that I could write an entire guide about *only* bracing your batcher against levelups. The easiest option is to ping-pong between servers, but with a bit of careful programming you can write your batcher so that it survives through multiple levels indefinitely (even without formulas).
- Refine your target selection: The algorithm mentioned earlier is far from the best or only way to pick a target. You can start thinking about factors like how much RAM you have available, how much it costs to rob a target, and how much RAM you can dedicate before it's better to just add a second target.
- Add more targets: I touched on it briefly, but why stop at one? Run two, or three, or a dozen batchers all optimized against different targets, each controlled by a master script that coordinates between them. The sky is the limit.
- Share what you've learned: If this guide has helped you at all, I encourage you to participate in the community and pay it forward. Help others who've struggled where you have, and work together to make that number go up as swiftly as possible.
