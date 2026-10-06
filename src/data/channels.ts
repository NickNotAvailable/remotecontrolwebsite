import type { ChannelSummary } from '../shared/protocol';

/**
 * The channel line-up. Each portfolio project is one channel.
 *
 * Videos: list one or more sources; the first one the browser can play is used.
 *  - Local files live in /public/media (see scripts/encode-video.sh to prepare your own).
 *  - Remote URLs work too (S3, Cloudflare R2, Mux/Vimeo MP4 renditions…). For the CRT shader
 *    effects the host must send `Access-Control-Allow-Origin`; without it the channel still
 *    plays, just without the WebGL treatment.
 *
 * All brands, titles and credits below are fictional placeholders.
 */
export interface VideoSource {
  src: string;
  type: string;
}

export interface Channel {
  id: string;
  number: number;
  client: string;
  title: string;
  category: string;
  year: number;
  role: string;
  runtime: string;
  description: string;
  credits: { label: string; value: string }[];
  sources: VideoSource[];
  poster: string;
  /** Accent used for this channel's on-screen graphics. */
  accent: string;
}

const base = import.meta.env.BASE_URL; // "/" normally, "./" for sub-path / static preview builds
const media = (name: string): Pick<Channel, 'sources' | 'poster'> => ({
  sources: [
    { src: `${base}media/${name}.mp4`, type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
    { src: `${base}media/${name}.webm`, type: 'video/webm; codecs="vp9, opus"' },
  ],
  poster: `${base}media/${name}.jpg`,
});

export const channels: Channel[] = [
  {
    id: 'meadow-spring',
    number: 1,
    client: 'Meadow & Co.',
    title: 'Spring, Unhurried',
    category: 'Lifestyle',
    year: 2025,
    role: 'Director',
    runtime: '0:60',
    description:
      'A slow pan across a waking valley for a homeware brand that wanted its spring range to feel like a deep breath.',
    credits: [
      { label: 'Agency', value: 'Field Office' },
      { label: 'Production', value: 'Northbound Pictures' },
      { label: 'DP', value: 'Ines Okafor' },
    ],
    accent: '#ffd36b',
    ...media('meadow'),
  },
  {
    id: 'lumen-bloom',
    number: 2,
    client: 'Lumen',
    title: 'Bloom',
    category: 'Beauty',
    year: 2025,
    role: 'Director',
    runtime: '0:30',
    description:
      'Macro photography and a single red flower for the launch of Lumen’s overnight serum. Shot in one day, on one lens.',
    credits: [
      { label: 'Agency', value: 'Studio Haldane' },
      { label: 'Production', value: 'Northbound Pictures' },
      { label: 'Colour', value: 'Glasshouse' },
    ],
    accent: '#ff6b6b',
    ...media('lumen'),
  },
  {
    id: 'still-source',
    number: 3,
    client: 'Still',
    title: 'Source',
    category: 'Beverage',
    year: 2024,
    role: 'Director / DP',
    runtime: '0:20',
    description:
      'A mineral water brand that only wanted to show the water. So we did — at the spring, at dawn, slowed right down.',
    credits: [
      { label: 'Agency', value: 'In-house' },
      { label: 'Production', value: 'Northbound Pictures' },
      { label: 'Sound', value: 'Field Recordings Ltd.' },
    ],
    accent: '#7fd8ff',
    ...media('still'),
  },
  {
    id: 'standard-since-1940',
    number: 4,
    client: 'The Daily Standard',
    title: 'Since 1940',
    category: 'Media',
    year: 2024,
    role: 'Director',
    runtime: '0:45',
    description:
      'A heritage spot for a newspaper’s anniversary, cut entirely from restored public-domain newsroom footage.',
    credits: [
      { label: 'Agency', value: 'Morrow & Vale' },
      { label: 'Edit', value: 'Cutting Room 9' },
      { label: 'Restoration', value: 'Archive Works' },
    ],
    accent: '#e8e2d0',
    ...media('standard'),
  },
  {
    id: 'forge-floor',
    number: 5,
    client: 'Forge Workwear',
    title: 'Built for the Floor',
    category: 'Apparel',
    year: 2024,
    role: 'Director',
    runtime: '0:30',
    description:
      'A rhythm piece for a workwear label, shot locked-off from the rafters of a working warehouse. No actors, no sets.',
    credits: [
      { label: 'Agency', value: 'Heavy Industries' },
      { label: 'Production', value: 'Northbound Pictures' },
      { label: 'Music', value: 'Low Tide Audio' },
    ],
    accent: '#ff9a3c',
    ...media('forge'),
  },
  {
    id: 'hearth-ceramics',
    number: 6,
    client: 'Hearth & Kiln',
    title: 'Everyday Ceramics',
    category: 'Retail',
    year: 2023,
    role: 'Director',
    runtime: '0:30',
    description:
      'An observational retail film: one morning in a ceramics warehouse, real customers, a hidden camera and a lot of plates.',
    credits: [
      { label: 'Agency', value: 'Common Thread' },
      { label: 'Production', value: 'Northbound Pictures' },
      { label: 'Music', value: 'Pastel Club' },
    ],
    accent: '#f2c9a0',
    ...media('hearth'),
  },
  {
    id: 'burrow-rise',
    number: 7,
    client: 'Burrow Coffee',
    title: 'Rise Slowly',
    category: 'Food & Drink',
    year: 2023,
    role: 'Director (Animation)',
    runtime: '0:30',
    description:
      'An animated spot for a coffee roaster whose customers are, in their words, “not morning people”.',
    credits: [
      { label: 'Agency', value: 'Soft Launch' },
      { label: 'Animation', value: 'Open Movie Studio' },
      { label: 'Sound', value: 'Foley Brothers' },
    ],
    accent: '#c8f07a',
    ...media('burrow'),
  },
  {
    id: 'aurora-northern',
    number: 8,
    client: 'Aurora',
    title: 'Northern Lights',
    category: 'Fragrance',
    year: 2022,
    role: 'Director / Design',
    runtime: '0:15',
    description:
      'A fully generative fragrance ident — colour fields drifting like the aurora — designed to loop forever on in-store screens.',
    credits: [
      { label: 'Agency', value: 'Polar Studio' },
      { label: 'Design', value: 'Avery Lane' },
      { label: 'Music', value: 'Night Drive' },
    ],
    accent: '#58f0c8',
    ...media('aurora'),
  },
];

export function lineup(): ChannelSummary[] {
  return channels.map((c) => ({
    id: c.id,
    number: c.number,
    client: c.client,
    title: c.title,
    category: c.category,
    year: c.year,
    poster: c.poster,
  }));
}
