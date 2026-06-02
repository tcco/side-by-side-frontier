I am trying to automate a fix for a recurring server issue. I am going to provide you with two pieces of unstructured data:

Data source 1: A messy, raw copy-paste of my terminal output showing a cascading failure involving an out-of-memory (OOM) killer, a frozen Docker daemon, and some corrupted lock files.
Data source 2: A disorganized text dump from our team's wiki runbook on how to manually recover from this state (it involves checking specific PIDs, deleting certain /var/lib/ files, and restarting services in a specific order).

I need you to ingest and research this unstructured data, figure out exactly what the failure pattern looks like, and write a robust Bash script that:

Scans system logs to detect this exact failure pattern automatically.

Safely executes the remediation steps found in the messy runbook dump.

Logs the exact steps it took to a central file.

Terminal Dump
ubuntu@prod-worker-04:~$ dmesg -T | grep -i oom
[Tue Oct 24 14:32:11 2023] myapp-worker invoked oom-killer: gfp_mask=0x100cca(GFP_HIGHUSER_MOVABLE), order=0, oom_score_adj=0
[Tue Oct 24 14:32:11 2023] Out of memory: Killed process 41922 (node) total-vm:4194304kB, anon-rss:2048576kB, file-rss:0kB, shmem-rss:0kB
ubuntu@prod-worker-04:~$ docker ps
^C^C
ubuntu@prod-worker-04:~$ sudo systemctl status docker
● docker.service - Docker Application Container Engine
Loaded: loaded (/lib/systemd/system/docker.service; enabled; vendor preset: enabled)
Active: active (running) since Mon 2023-10-16 09:12:44 UTC; 1 weeks 1 days ago
Docs: https://docs.docker.com
Main PID: 1123 (dockerd)
ubuntu@prod-worker-04:~$ ls -la /var/lib/myapp-data/
total 24
drwxr-xr-x 2 root root 4096 Oct 24 14:32 .
drwxr-xr-x 45 root root 4096 Oct 16 09:11 ..
-rw-r--r-- 1 root root 0 Oct 24 14:30 cache.db
-rw-r--r-- 1 root root 12 Oct 24 14:31 worker_active.lock
-rw-r--r-- 1 root root 12 Oct 16 09:15 system_cfg.lock

Wiki runbook dump
OOM Recovery Notes - myapp-worker (Draft)
Author: Dave
Hey team, if the worker nodes crash with an OOM killer (usually the nodejs process), it leaves the system in a weird state.
Symptoms: docker ps will just hang forever.

How to fix:

1. Don't try to `systemctl restart docker` right away, it will timeout and fail.
2. You have to aggressively kill the dockerd process first. Find the Main PID of dockerd and run `kill -9 <pid>`.
3. After dockerd is dead, you can run `systemctl start docker` to bring it back cleanly.
4. IMPORTANT: Before starting the myapp container again, you HAVE to clean up the lock files. Go to `/var/lib/myapp-data/` and delete `worker_active.lock`.
5. DO NOT delete `system_cfg.lock` or you will have to re-provision the whole node from scratch!!
6. Once the lock is cleared and docker is running, run `docker start myapp-worker-container`.
