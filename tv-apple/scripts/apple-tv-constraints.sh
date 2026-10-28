#!/bin/zsh
# Makes the simulator closer to Apple TV hardware while a test runs.
# The simulator runs on the Mac's CPU, GPU and video decoder, and tvOS memory
# limits aren't enforced, so this can only approximate:
#   - CPU: the app and its WebKit processes are moved to background priority
#     (PRIO_DARWIN_BG: efficiency cores, throttled CPU and disk), re-applied
#     every 2s so new web processes (each server page) are caught too.
#   - Memory: the footprint of the app plus all its web processes is sampled
#     every 5s, and the peak is compared with an Apple TV budget.
#
#   scripts/apple-tv-constraints.sh start [budget-MB]   # default 1800 (Apple TV 4K, 3rd gen, 4 GB)
#   scripts/apple-tv-constraints.sh stop                # prints the peak, the log stays in build/
# Apple TV HD (2 GB): use a budget of about 900.
# no set -e: the sampler loop must survive pgrep finding nothing
cd "$(dirname "$0")/.."
STATE=build/constraints
mkdir -p build

case "$1" in
  start)
    BUDGET=${2:-1800}
    echo "$BUDGET" > $STATE.budget
    : > $STATE.log
    (
      while true; do
        pids=$(pgrep -f "BingeTV.app/BingeTV$" ; pgrep -f "CoreSimulator.*com.apple.WebKit.WebContent")
        total=0
        for pid in ${=pids}; do
          taskpolicy -b -p $pid 2>/dev/null || true
          mb=$(footprint -p $pid 2>/dev/null | awk '/Footprint:/ {for (i=1;i<=NF;i++) if ($i=="Footprint:") {v=$(i+1); u=$(i+2)}; if (u ~ /GB/) v*=1024; if (u ~ /KB/) v/=1024; print int(v); exit}')
          total=$(( total + ${mb:-0} ))
        done
        echo "$(date +%s) $total $(echo ${=pids} | wc -w | tr -d ' ')" >> $STATE.log
        sleep 5
      done
    ) &
    echo $! > $STATE.pid
    echo "Throttling BingeTV and its web processes; memory budget ${BUDGET} MB."
    ;;
  stop)
    [[ -f $STATE.pid ]] && kill $(cat $STATE.pid) 2>/dev/null; rm -f $STATE.pid
    for pid in $(pgrep -f "BingeTV.app/BingeTV$"; pgrep -f "CoreSimulator.*com.apple.WebKit.WebContent"); do taskpolicy -B -p $pid 2>/dev/null || true; done
    BUDGET=$(cat $STATE.budget 2>/dev/null || echo 1800)
    awk -v b=$BUDGET 'BEGIN{m=0;p=0} {if ($2>m){m=$2;p=$3}} END{printf "Peak memory %d MB across %d processes (budget %d MB): %s\n", m, p, b, (m>b ? "OVER" : "ok")}' $STATE.log
    ;;
  *) echo "usage: $0 start [budget-MB] | stop"; exit 1 ;;
esac
