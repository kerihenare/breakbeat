# Head of Engineering Technical Exercise

You have up to 4 hours. Please do not spend longer.

You may use any AI coding tools you normally use, including Claude Code, Codex, Cursor, ChatGPT, etc. We will reimburse token/API costs up to $100.

Please share:

- A GitHub repo link we can clone and run locally.
- any environment variables of .env file required to run the app
- A short write-up explaining your approach, trade-offs, and what you would do next.
- A transcript of your interaction with Claude Code/Codex/other agents.

Feel free to include points 3 and 4 in the repo you share.

## Task

Build a basic web app that accepts:

- A company name; and/or
- A company homepage URL.

The app should start a background job that finds as much content about the company as possible from the last 36 months.

Content types may include:

- News articles
- Trade publications
- Blog posts
- Press releases
- Major social posts
- Newsletters
- Podcasts

Content should not include:

- product review/comparison pages
- ecommerce pages
- The company's own channels (ie their own website, blog, LinkedIn, etc)
- Link aggregator sites

The app should present results in an easily reviewable list for the user.

## What we care about

We do not expect a complete commercial-grade media monitoring product in 4 hours.

We care about:

- Product judgement
- Technical architecture
- Agent-assisted execution
- Handling ambiguity
- Search/retrieval strategy
- Background job design
- Result quality and deduplication
- Clear local setup
- Sensible trade-offs
- Security and cost awareness

## Expected local experience

We should be able to:

- Clone the repo.
- Add any required API keys to an `.env` file.
- Run the app locally.
- Enter a company name or homepage.
- Start a background job.
- See job status.
- Review returned content in a list.

Note that no authentication, hosting, CI/CD etc is required.
