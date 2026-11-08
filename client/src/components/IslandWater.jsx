import {useId} from 'react';

// Authored masks contain only open water. No shore, building or boat moves.
const WATER = {
  bay: {mask: '500,650 525,590 615,598 666,651 673,711 690,788 700,980 450,980 490,800',
    bounds: [495, 615, 185, 350], fall: [438, 364, 12, 36]},
  shore: {mask: '470,650 560,615 670,640 675,735 625,850 740,960 350,960 400,840',
    bounds: [410, 660, 250, 285], fall: [448, 468, 10, 35]},
};

/** Small SVG highlights, animated by CSS rather than a continuous JS loop. */
export function IslandWater({variant}) {
  const id = useId();
  const water = WATER[variant];
  if (!water) return null;
  const [x, y, width, height] = water.bounds;
  const [fx, fy, fw, fh] = water.fall;
  return <svg className="island-water" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id={id}><polygon points={water.mask} /></clipPath></defs>
    <g clipPath={`url(#${id})`}>
      {Array.from({length: 8}, (_, group) => <g className="island-water__glints" key={group}
        style={{'--ripple-delay': `${group * -.71}s`, '--ripple-duration': `${4.8 + group * .35}s`}}>
        {Array.from({length: 5}, (_, index) => {
          const seed = group * 5 + index;
          const px = x + ((seed * 73 + 31) % 101) / 101 * width;
          const py = y + ((seed * 47 + 17) % 103) / 103 * height;
          const span = 5 + seed % 7;
          return <path key={index} d={`M${px} ${py}q${span / 2} -1.4 ${span} 0t${span * .65} 0`}
            vectorEffect="non-scaling-stroke" />;
        })}
      </g>)}
    </g>
    <g className="island-water__falls">
      {[0, 1, 2].map(index => <path key={index}
        d={`M${fx + index * fw / 3} ${fy}q3 ${fh * .45} 0 ${fh}`} vectorEffect="non-scaling-stroke" />)}
    </g>
  </svg>;
}
