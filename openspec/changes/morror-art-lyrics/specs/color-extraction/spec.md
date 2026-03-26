## ADDED Requirements

### Requirement: System MUST extract dominant color from album thumbnail
Use Canvas API to sample pixel colors and find the most prominent non-grayscale color.

#### Scenario: Valid thumbnail URL
- **WHEN** thumbnail URL loads successfully in a hidden canvas
- **THEN** return the dominant color as a hex string

#### Scenario: CORS blocked thumbnail
- **WHEN** canvas `drawImage` fails due to cross-origin restrictions
- **THEN** return null (caller uses fallback color)

#### Scenario: Very dark or very bright image
- **WHEN** sampled pixels are mostly near-black or near-white
- **THEN** skip those pixels and find the next most common hue

### Requirement: Color extraction result MUST be cached per video
Avoid re-extracting on every render.

#### Scenario: Same video rendered twice
- **WHEN** MorrorLyrics unmounts and remounts for the same videoId
- **THEN** use cached color from previous extraction, no new canvas operation
