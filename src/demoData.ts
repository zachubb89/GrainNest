export const demoSvgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <style>
    .demo-path { stroke: #ff0000; stroke-width: 1.5; fill: none; }
  </style>
  <g id="plate_with_holes">
    <rect class="demo-path" x="10" y="10" width="120" height="80" rx="5" />
    <circle class="demo-path" cx="30" cy="30" r="8" />
    <circle class="demo-path" cx="110" cy="30" r="8" />
    <circle class="demo-path" cx="30" cy="70" r="8" />
    <circle class="demo-path" cx="110" cy="70" r="8" />
  </g>
  <g id="concentric_ring">
    <circle class="demo-path" cx="200" cy="50" r="40" />
    <circle class="demo-path" cx="200" cy="50" r="20" />
  </g>
  <g id="L_bracket">
    <path class="demo-path" d="M 280,10 L 350,10 L 350,30 L 300,30 L 300,80 L 280,80 Z" />
    <circle class="demo-path" cx="290" cy="20" r="5" />
    <circle class="demo-path" cx="290" cy="60" r="5" />
    <circle class="demo-path" cx="330" cy="20" r="5" />
  </g>
  <g id="gusset">
    <path class="demo-path" d="M 380,10 L 440,10 L 380,70 Z" />
    <circle class="demo-path" cx="395" cy="25" r="6" />
  </g>
  <g id="slotted_rail">
    <rect class="demo-path" x="10" y="110" width="180" height="25" rx="3" />
    <rect class="demo-path" x="30" y="115" width="140" height="15" rx="7.5" />
  </g>
  <g id="spacer">
    <circle class="demo-path" cx="230" cy="120" r="15" />
    <circle class="demo-path" cx="230" cy="120" r="6" />
  </g>
</svg>`;

export const demoQuantities = {
  "plate_with_holes": 2,
  "concentric_ring": 2,
  "L_bracket": 4,
  "gusset": 6,
  "slotted_rail": 2,
  "spacer": 8,
};
