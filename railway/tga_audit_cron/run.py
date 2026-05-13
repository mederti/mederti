#!/usr/bin/env python3
"""
Mederti — Daily TGA Accuracy Audit
Runs scripts/audit_tga_accuracy.py against the live TGA MSI site,
sampling 50 active AU shortage records and logging discrepancies
to audit_logs. Scheduled daily at 08:00 UTC on Railway.

Exit code is non-zero when any critical discrepancy is found,
so Railway surfaces a failed run.
"""
import subprocess
import sys

if __name__ == "__main__":
    result = subprocess.run(
        [sys.executable, "scripts/audit_tga_accuracy.py"],
    )
    sys.exit(result.returncode)
