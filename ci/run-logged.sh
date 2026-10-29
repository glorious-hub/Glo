#!/usr/bin/env bash
# ci/run-logged.sh NAME command... : runs the command with its output in ci-logs/NAME.log; on failure the
# lines that say what went wrong and the end of the log are reported as annotations.
name=$1
shift
mkdir -p ci-logs
log="ci-logs/$name.log"
"$@" > "$log" 2>&1
rc=$?
tail -n 40 "$log"
if [ "$rc" -ne 0 ]; then
  esc() { sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN { ORS = "%0A" } { print }' | cut -c1-3900; }
  grep -n -E -i 'error|failed|went wrong|exception|undefined reference|cannot|not found|no such' "$log" \
    | grep -v -i -E 'warning|-Werror|error\.h|errors\.cpp|_error\b' | head -n 60 > ci-logs/.errlines
  echo "::error title=$name: error lines::$(head -n 30 ci-logs/.errlines | esc)"
  echo "::error title=$name: more error lines::$(tail -n +31 ci-logs/.errlines | esc)"
  echo "::error title=$name: end of log::$(tail -n 70 "$log" | esc)"
fi
exit "$rc"
