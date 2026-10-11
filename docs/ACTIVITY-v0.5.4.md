# Working / Thinking — 0.5.4 verification

The signing build removes the temporary test labels and retains the tested compact PDF change. The user confirmed test 4 worked and supplied an HTML export: the expanded activity heading, progress paragraph and search summary appear exactly once before the correct answer. Other collapsed sections correctly contain unavailable-content notices. This validates the supplied case, not every interface layout.

In ChatGPT, expand the activity section, open Export options and enable **Include Working / Thinking sections** (default off). Export HTML first. The output should have a details section before the associated final answer, including its heading, progress text and nested tool summary exactly once. The supplied example is a Worked label, a progress paragraph and a Searched summary. Synthetic test fixtures preserve this structure without retaining the user's personal content.

TXT/Markdown include the section before the answer; JSON has an `activities` array on the associated message; PDF receives the same open details markup. Gemini disables this option. Content is limited to what remains available in the page. Collapsed blocks are labelled as not collected; the exporter does not click buttons or retrieve private reasoning.

The provided fragment did not include the outer turn boundary. The implementation only associates a section contained within one assistant node, or sharing an explicit `data-turn-key` / legacy conversation-turn article with exactly one assistant node. If this boundary is absent or ambiguous, export stops with an explanatory error. This is an intentional limitation of the first real-chat test, not a claim of full issue #4 support. Turn the option off to export ordinary messages in an unsupported layout.

Check the supplied chat for correct ordering, no duplicate progress summaries and no content from another answer. Selected-only exports should retain activity only for selected assistant messages. No source fixture contains the original private conversation, and nothing has been published or sent to the issue author.
