"""What the agent remembers, beyond the help articles.

  team answers   question and answer pairs the team writes, searched and cited
                 like help articles (long term, shared by every visitor)
  knowledge gaps product questions the agent could not answer, grouped so the
                 team can see what to write next
  customer memory short facts about one signed-in customer, from their earlier
                 conversations (long term, private to that customer, 90 days)

The conversation itself (the last few turns) is the short-term memory, read
straight from the messages table on every turn.
"""
