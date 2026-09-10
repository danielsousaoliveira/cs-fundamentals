# Repository settings

GitHub repository settings live outside the codebase. This file is the record of
what is applied in the hosting interface so the state is not undocumented.

Re-apply after any change here. The description and topics can be set with the
`gh` CLI; the social preview image is upload-only through the web UI.

## Description

> An in-depth, visual intro to CS: every complexity bound derived on the page, every structure shown running, and every failure mode and when-NOT-to-use-it named — the parts most treatments skip. 130+ pages across data structures, systems, databases, data and AI engineering.

```sh
gh repo edit danielsousaoliveira/cs-fundamentals \
  --description "An in-depth, visual intro to CS: every complexity bound derived on the page, every structure shown running, and every failure mode and when-NOT-to-use-it named — the parts most treatments skip. 130+ pages across data structures, systems, databases, data and AI engineering." \
  --homepage "https://danielsousaoliveira.github.io/cs-fundamentals/"
```

## Homepage

`https://danielsousaoliveira.github.io/cs-fundamentals/`

## Topics

Each topic maps to material the site treats in depth, not everything it mentions.

`computer-science`, `data-structures`, `algorithms`, `system-design`,
`distributed-systems`, `databases`, `sql`, `query-optimization`,
`vector-database`, `data-engineering`, `cloud-infrastructure`, `kubernetes`,
`ai-engineering`, `rag`, `llm`, `web-development`, `software-architecture`,
`production-engineering`, `incident-response`, `learning-resources`

```sh
gh repo edit danielsousaoliveira/cs-fundamentals \
  --add-topic computer-science,data-structures,algorithms,system-design,distributed-systems \
  --add-topic databases,sql,query-optimization,vector-database,data-engineering \
  --add-topic cloud-infrastructure,kubernetes,ai-engineering,rag,llm \
  --add-topic web-development,software-architecture,production-engineering,incident-response,learning-resources
```

## Social preview image

Set the social preview to `public/og.png` (1200×630, within GitHub's accepted
range). Regenerate it with `pnpm og:image` after changing its design — never
edit the PNG by hand. This is the same image the site serves as its Open Graph
card via `src/components/overrides/Head.astro`.

Upload path: repository **Settings → General → Social preview → Upload an image**.
