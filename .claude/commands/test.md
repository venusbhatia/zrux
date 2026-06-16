---
description: Test a retrieval question end to end and show every stage of the pipeline
tools: Read, Bash
---

Run this founder question through the full retrieval pipeline and show me every stage:

Question: $ARGUMENTS

Show me each stage in order. Do not skip any.

Stage 0 - Semantic cache check
Check Redis for a near-hit on this question for the test user_id. Print HIT or MISS. If HIT, show what the cached answer is and stop.

Stage 1 - Query understanding
Call the query understanding LLM. Print the full structured plan it returns as JSON: semantic_query, keyword_terms, sources, after, before, type, status, entities, intent, time_basis, recency_weight.

Stage 2 - Hybrid retrieval
Run hybrid_search() with the plan's parameters. Print:
- How many chunks came back from the dense CTE
- How many chunks came back from the keyword CTE
- How many unique chunks after RRF fusion
- The top 10 chunks with their RRF score, source, and the first 80 characters of content

Stage 3 - Graph expansion
List which named entities from the question were resolved to entity rows. Show their resolved name and email if present. Show any edges pulled in.

Stage 4 - Rerank
Show the top 10 chunks after Cohere reranking with their new scores. Note any that changed rank significantly from Stage 2.

Stage 5 - Chunk to item rollup
Show how many unique item_ids remain after rollup. List them with source and title.

Stage 6 - Retrieval rail
Show how many items were dropped by the rail and why.

Stage 7 - Assembly
Show the final assembled context block that would be sent to synthesis. Truncate to 400 characters per item but show all items.

Stage 8 - Synthesis
Run synthesis and print the final answer with citations. Note whether the answer was written to cache.

If any stage fails or returns empty, stop there and tell me exactly what went wrong and which config or data is the likely cause.
