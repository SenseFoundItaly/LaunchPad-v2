'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { ScoreDimension } from '@/types';

interface RadarChartProps {
  dimensions: ScoreDimension[];
  size?: number;
}

export default function RadarChart({ dimensions, size = 300 }: RadarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || dimensions.length === 0) {return;}

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = 50;
    const radius = (size - margin * 2) / 2;
    const center = size / 2;
    const levels = 5;
    const angleSlice = (Math.PI * 2) / dimensions.length;

    const g = svg
      .attr('width', size)
      .attr('height', size)
      .append('g')
      .attr('transform', `translate(${center},${center})`);

    // Grid circles
    for (let level = 1; level <= levels; level++) {
      const r = (radius / levels) * level;
      g.append('circle')
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5);

      g.append('text')
        .attr('x', 4)
        .attr('y', -r)
        .attr('fill', '#666')
        .attr('font-size', '10px')
        .text(`${(level / levels) * 100}`);
    }

    // Axis lines and labels
    dimensions.forEach((dim, i) => {
      const angle = angleSlice * i - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      g.append('line')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', x)
        .attr('y2', y)
        .attr('stroke', '#444')
        .attr('stroke-width', 0.5);

      const labelX = Math.cos(angle) * (radius + 30);
      const labelY = Math.sin(angle) * (radius + 30);

      g.append('text')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#aaa')
        .attr('font-size', '11px')
        .text(dim.name.split(' ')[0]);
    });

    // Data polygon
    const lineGen = d3
      .lineRadial<ScoreDimension>()
      .radius((d) => (d.score / 100) * radius)
      .angle((_, i) => i * angleSlice)
      .curve(d3.curveLinearClosed);

    g.append('path')
      .datum(dimensions)
      .attr('d', lineGen)
      .attr('fill', 'rgba(59, 130, 246, 0.2)')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2);

    // Data points
    dimensions.forEach((dim, i) => {
      const angle = angleSlice * i - Math.PI / 2;
      const r = (dim.score / 100) * radius;

      g.append('circle')
        .attr('cx', Math.cos(angle) * r)
        .attr('cy', Math.sin(angle) * r)
        .attr('r', 4)
        .attr('fill', '#3b82f6')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5);
    });
  }, [dimensions, size]);

  return <svg ref={svgRef} className="mx-auto" />;
}
