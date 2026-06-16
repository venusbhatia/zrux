---
description: Run a full ingestion poll for one source and show exactly what was ingested
tools: Read, Bash, Edit
---

Run a full ingestion poll for the source: $ARGUMENTS

Steps to follow exactly:

1. Find the connector file for this source in lib/connectors/. Read it.
2. Call the poll() method with a since date of 7 days ago.
3. Show me how many raw items were returned from the source.
4. Run normalize, enrich, and embed on the first 3 items only (do not write to the database yet).
5. Print the normalized context_item shape for each of those 3 items as JSON.
6. Print the chunk content (the enriched text that would be embedded) for each item.
7. Show me the source_created_at and source_updated_at values. Confirm both are present and non-null.
8. Check whether any of the 3 items would trigger triple extraction (is the source in the high-signal list: email, calendar, Notion, Linear, meetings). Tell me yes or no and why.
9. If this is an audio source, confirm the Deepgram diarize=true flag is set.
10. After the dry run, ask me to confirm before writing anything to context_item or context_chunk.

If $ARGUMENTS is empty, list the available connectors and ask which one to use.
