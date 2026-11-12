import type { Locale } from '@/src/i18n/types';
import { guideCopy } from './content';
import type { GuideMap } from './model';

/** The downloadable reference uses exactly the same nodes as the in-app guide. */
export function guideMarkdown(maps: GuideMap[], locale: Locale): string {
  const copy = guideCopy(locale);
  const id = (map: GuideMap, node: string) => `${map.id}_${node}`.replaceAll('-', '_');
  const quote = (value: string) => value.replaceAll('"', '&quot;').replaceAll('\n', ' ');
  const sections = [`# Lumbung — ${copy.title}`, copy.note];
  for (const map of maps) {
    const graph = [
      'flowchart TD',
      ...map.nodes.map(node => `  ${id(map, node.id)}["${quote(node.title)}"]`),
      ...map.edges.map(edge => `  ${id(map, edge.from)} ${edge.both ? '<-->' : '-->'} ${id(map, edge.to)}`),
    ];
    sections.push(`## ${map.label}`, map.description, '```mermaid\n' + graph.join('\n') + '\n```', map.takeaway);
    for (const [i, node] of map.nodes.entries()) {
      sections.push(`### ${i + 1}. ${node.title}`, `**${copy.owner}:** ${node.owner}`,
        `**${copy.input}:** ${node.input}`, `**${copy.action}:** ${node.action}`,
        `**${copy.output}:** ${node.output}`, `**${copy.exception}:** ${node.exception}`);
      if (node.example) sections.push(`**${copy.example}:** ${node.example}`);
      if (node.href) sections.push(`${copy.open}: \`${node.href}\``);
      sections.push(`${copy.source}: ${node.source.map(source => `\`${source}\``).join(', ')}`);
    }
  }
  return sections.join('\n\n') + '\n';
}
