# cfo.ai business plan

**Plan (view-only, no login):** https://cfo.ai/s/pDpH9dFTal4PAy76 (plan, assumptions, unit economics, 12-month operating forecast).
Built with Ari in cfo.ai on 11 Oct from Resurgo's measured run data; Ari checked all 72 forecast months (6 cases × 12) against independent arithmetic.

**Measured inputs:** 24 held-out repos checked by agent v1; median check 3.4 min wall, mean 5.7 min container time; 27 model calls, about 135,000 tokens in total, under $0.01 per check in neatlogs; 13 of 24 built cleanly; 1 genuine verified fix among 11 broken (9.1%). Server: $7/month (4 vCPU, 15 GB).

**Recommendation:** $12/month per account for nightly checks and verified-fix pull requests on up to 10 repos, with a free tier of weekly checks on 3 public repos. Pay-per-fix ($2 credits) loses money once the backlog is repaired: per-fix revenue shrinks as fixes succeed.

| Unit economics ($7 server) | |
| --- | --- |
| Compute per check | $0.00115 |
| Total cost per check (with a $0.01 model-call ceiling) | $0.0112 |
| Cost per verified fix at 10% / 25% / 40% success | $0.245 / $0.099 / $0.062 |
| Monthly cost of a full 10-repo account | $3.35 |
| Gross margin incl. payment fees (A) | 66.7% |
| Break-even | 3 paying accounts (with 25 free), on one server |

Assumptions flagged by the plan itself: the 10–40% repair range is a planning range, not demonstrated; founder pay, marketing and support are excluded; new monthly breakage (1%) is unmeasured.
