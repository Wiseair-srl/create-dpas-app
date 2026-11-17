<template>
  <svg
    class="dh-diagram"
    viewBox="0 0 420 360"
    role="img"
    aria-labelledby="dh-diagram-title dh-diagram-desc"
  >
    <title id="dh-diagram-title">Two planes, one catalog</title>
    <desc id="dh-diagram-desc">
      The view plane, in the browser, stacked above the domain plane, on the server. A single
      catalog line runs through both.
    </desc>

    <!-- View plane · browser -->
    <path class="dh-diagram-plane dh-diagram-plane--view" d="M160 35 290 100 160 165 30 100Z" />
    <!-- Domain plane · server -->
    <path class="dh-diagram-plane dh-diagram-plane--domain" d="M160 185 290 250 160 315 30 250Z" />

    <!-- One catalog, through both. -->
    <line class="dh-diagram-catalog" x1="160" y1="14" x2="160" y2="346" />
    <text class="dh-diagram-label dh-diagram-label--muted" x="170" y="22">catalog</text>
    <rect class="dh-diagram-token" x="157" y="11" width="6" height="6" />

    <circle class="dh-diagram-node dh-diagram-node--view" cx="160" cy="100" r="4" />
    <circle class="dh-diagram-node dh-diagram-node--domain" cx="160" cy="250" r="4" />

    <line class="dh-diagram-leader" x1="294" y1="100" x2="304" y2="100" />
    <text class="dh-diagram-label dh-diagram-label--view" x="310" y="97">VIEW PLANE</text>
    <text class="dh-diagram-label dh-diagram-label--muted" x="310" y="114">browser</text>

    <line class="dh-diagram-leader" x1="294" y1="250" x2="304" y2="250" />
    <text class="dh-diagram-label dh-diagram-label--domain" x="310" y="247">DOMAIN PLANE</text>
    <text class="dh-diagram-label dh-diagram-label--muted" x="310" y="264">server</text>
  </svg>
</template>
