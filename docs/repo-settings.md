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

Replaces the full topic set rather than adding to whatever is already there, so
rerunning it after editing the list above always matches the document:

```sh
gh api repos/danielsousaoliveira/cs-fundamentals/topics \
  --method PUT \
  --field 'names[]=computer-science' --field 'names[]=data-structures' \
  --field 'names[]=algorithms' --field 'names[]=system-design' \
  --field 'names[]=distributed-systems' --field 'names[]=databases' \
  --field 'names[]=sql' --field 'names[]=query-optimization' \
  --field 'names[]=vector-database' --field 'names[]=data-engineering' \
  --field 'names[]=cloud-infrastructure' --field 'names[]=kubernetes' \
  --field 'names[]=ai-engineering' --field 'names[]=rag' \
  --field 'names[]=llm' --field 'names[]=web-development' \
  --field 'names[]=software-architecture' --field 'names[]=production-engineering' \
  --field 'names[]=incident-response' --field 'names[]=learning-resources'
```

## Social preview image

Set the social preview to `public/og.png` (1200×630, within GitHub's accepted
range). Regenerate it with `pnpm og:image` after changing its design — never
edit the PNG by hand. This is the same image the site serves as its Open Graph
card via `src/components/overrides/Head.astro`.

Upload path: repository **Settings → General → Social preview → Upload an image**.
