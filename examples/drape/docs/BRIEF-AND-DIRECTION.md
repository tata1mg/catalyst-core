# Brief & direction

## Purpose
<!-- One sentence: what is this project and why does it exist? -->
drape — an AI photo generation app for clothing lines (universal app: web + iOS + Android via catalyst-core).

## Audience
Independent Indian fashion designers, boutique owners, and ethnic-wear sellers whose product is fabric and craft (sarees, lehengas, kurtas) and who need shoot-grade imagery without studio costs. They care about how the garment is *photographed*, not just listed.

## Tone
Editorial, considered, warm, premium, quietly confident. Closer to a fashion magazine masthead than a SaaS dashboard. Not playful, not utilitarian, not technical/cool. Serif headlines do the heavy lifting; copy is short and unhurried.

## Success criteria
<!-- How do you know it's working? Qualitative or quantitative. -->
<!-- e.g. shoots completed per active user, % of low-res previews upscaled, return rate. -->

## Constraints
- Universal app shipped via catalyst-core (web SSR + native via webview).
- Stack: React + Redux Toolkit + @tata1mg/router + Tailwind v4.
- Mobile-first design canvas (iPhone 14: 390 × 844). Web/tablet are responsive expansions of the mobile column, not separate compositions.
- Single visual mode for now — dark mode is deferred until a deliberate decision is made (warm dark vs cool dark — see `DESIGN-TOKENS.md`).
