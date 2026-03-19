"use client";
import { useEffect, useRef } from "react";

export function SpinningGlobe({ width = 600, height = 600 }: { width?: number; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      const d3 = await import("d3");
      const topojsonClient = await import("topojson-client");

      if (cancelled || !containerRef.current) return;

      const container = containerRef.current;
      container.innerHTML = "";

      const colorScale = d3.scaleLinear<string>()
        .domain([0, 100])
        .range(["#1e3a5f", "#7dd3fc"]);

      const svg = d3.select(container).append("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .style("max-width", "100%")
        .style("height", "auto");

      const projection = d3.geoOrthographic()
        .scale(width * 0.4)
        .translate([width / 2, height / 2])
        .rotate([0, -20]);

      const path = d3.geoPath().projection(projection);

      const routesData = [
        [[121, 31], [140, 35], [-118, 34]],
        [[-74, 40], [-10, 48], [4, 52]],
        [[103, 1], [80, 13], [50, 25], [32, 31], [12, 41]],
        [[-43, -22], [-9, 38]],
        [[151, -33], [103, 1]],
        [[-118, 34], [-79, 9], [-74, 40]],
        [[121, 31], [103, 1], [72, 19]],
        [[18, -34], [35, -20], [55, 25]],
        [[139, 35], [151, -33]],
      ].map(coords => ({ type: "LineString" as const, coordinates: coords }));

      const cities = [
        { coords: [139.7, 35.7] }, { coords: [77.2, 28.6] },
        { coords: [121.5, 31.2] }, { coords: [-46.6, -23.6] },
        { coords: [72.9, 19.1] }, { coords: [-74.0, 40.7] },
        { coords: [-0.1, 51.5] }, { coords: [103.8, 1.4] },
        { coords: [151.2, -33.9] }, { coords: [3.4, 6.5] },
        { coords: [31.2, 30.0] }, { coords: [29.0, 41.0] },
        { coords: [-118.2, 34.1] }, { coords: [37.6, 55.8] },
      ];

      // Globe background — dark ocean
      svg.append("circle")
        .attr("cx", width / 2).attr("cy", height / 2)
        .attr("r", projection.scale()!)
        .attr("fill", "#0a1628");

      // Graticule — subtle on dark
      svg.append("path")
        .datum(d3.geoGraticule()())
        .attr("fill", "none")
        .attr("stroke", "rgba(255,255,255,0.06)")
        .attr("stroke-width", 0.5)
        .attr("d", path);

      const laneGroup = svg.append("g");
      const pulseGroup = svg.append("g");
      const countryGroup = svg.append("g");
      const cityGroup = svg.append("g");

      // Load world topology
      const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json") as TopoJSON.Topology;
      if (cancelled) return;

      const countries = topojsonClient.feature(world, world.objects.countries as TopoJSON.GeometryCollection).features;

      countryGroup.selectAll("path")
        .data(countries)
        .enter().append("path")
        .attr("stroke", "rgba(255,255,255,0.15)")
        .attr("stroke-width", 0.3)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .style("fill", (_d: any, i: number) => colorScale(20 + (i * 7) % 80))
        .attr("d", path as never);

      laneGroup.selectAll("path")
        .data(routesData)
        .enter().append("path")
        .attr("fill", "none")
        .attr("stroke", "rgba(255,255,255,0.08)")
        .attr("stroke-width", 0.8)
        .attr("stroke-opacity", 0.5)
        .attr("d", path as never);

      const pulsePaths = pulseGroup.selectAll("path")
        .data(routesData)
        .enter().append("path")
        .attr("fill", "none")
        .attr("stroke", "#7dd3fc")
        .attr("stroke-width", 1.2)
        .attr("stroke-linecap", "round")
        .attr("stroke-opacity", 0.8)
        .attr("stroke-dasharray", "4, 120")
        .attr("d", path as never);

      const cityMarkers = cityGroup.selectAll("circle")
        .data(cities)
        .enter().append("circle")
        .attr("r", 2.2)
        .attr("fill", "#ffffff")
        .attr("opacity", 0.6);

      // ── Satellites ──────────────────────────────────────────────────
      const satelliteGroup = svg.append("g");
      const satellites = [
        { inclination: 30, phase: 0,   speed: 0.008, altitude: 1.45 },
        { inclination: 55, phase: 120, speed: 0.006, altitude: 1.55 },
        { inclination: 70, phase: 240, speed: 0.010, altitude: 1.38 },
      ];

      // Satellite body + trail for each
      const satElements = satellites.map((sat) => {
        const g = satelliteGroup.append("g");
        // Trail
        g.append("line")
          .attr("stroke", "rgba(125,211,252,0.4)")
          .attr("stroke-width", 1.2)
          .attr("stroke-linecap", "round");
        // Dot
        g.append("circle")
          .attr("r", 2.5)
          .attr("fill", "#ffffff");
        // Glow
        g.append("circle")
          .attr("r", 7)
          .attr("fill", "none")
          .attr("stroke", "rgba(125,211,252,0.3)")
          .attr("stroke-width", 0.8);
        return { ...sat, el: g, angle: sat.phase * (Math.PI / 180) };
      });

      let pulseOffset = 0;

      const timer = d3.timer(() => {
        if (cancelled) { timer.stop(); return; }

        const rotate = projection.rotate();
        projection.rotate([rotate[0] + 0.15, rotate[1]]);

        countryGroup.selectAll("path").attr("d", path as never);
        laneGroup.selectAll("path").attr("d", path as never);
        pulsePaths.attr("d", path as never);

        // Graticule update
        svg.select("path").attr("d", path(d3.geoGraticule()()) as string);

        pulseOffset -= 0.6;
        pulsePaths.style("stroke-dashoffset", pulseOffset);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cityMarkers.each(function (d: any) {
          const center = projection.invert!([width / 2, height / 2])!;
          const isVisible = d3.geoDistance(d.coords as [number, number], center as [number, number]) < Math.PI / 2;
          if (isVisible) {
            const p = projection(d.coords as [number, number])!;
            d3.select(this as Element).attr("cx", p[0]).attr("cy", p[1]).style("opacity", 0.8);
          } else {
            d3.select(this as Element).style("opacity", 0);
          }
        });

        // Animate satellites
        const cx = width / 2;
        const cy = height / 2;
        const globeR = projection.scale()!;

        satElements.forEach((sat) => {
          sat.angle += sat.speed;
          const orbitR = globeR * sat.altitude;
          const incRad = sat.inclination * (Math.PI / 180);

          // 3D orbit position
          const x3d = Math.cos(sat.angle) * orbitR;
          const y3d = Math.sin(sat.angle) * Math.sin(incRad) * orbitR;
          const z3d = Math.sin(sat.angle) * Math.cos(incRad) * orbitR;

          // Project to 2D
          const sx = cx + x3d;
          const sy = cy - y3d;

          // Trail — short segment behind
          const trailAngle = sat.angle - 0.25;
          const tx = cx + Math.cos(trailAngle) * orbitR;
          const ty = cy - Math.sin(trailAngle) * Math.sin(incRad) * orbitR;
          const tz = Math.sin(trailAngle) * Math.cos(incRad) * orbitR;

          // Only show when in front of globe (z > 0) or far enough from center
          const isFront = z3d > 0;
          const trailFront = tz > 0;
          const opacity = isFront ? 0.9 : 0.15;

          sat.el.select("circle:first-of-type")
            .attr("cx", sx).attr("cy", sy)
            .attr("opacity", opacity);
          sat.el.select("circle:last-of-type")
            .attr("cx", sx).attr("cy", sy)
            .attr("opacity", opacity * 0.5);
          sat.el.select("line")
            .attr("x1", trailFront ? tx : sx).attr("y1", trailFront ? ty : sy)
            .attr("x2", sx).attr("y2", sy)
            .attr("opacity", (isFront && trailFront) ? 0.4 : 0.08);
        });
      });

      return () => { timer.stop(); };
    })();

    return () => { cancelled = true; };
  }, [width, height]);

  return <div ref={containerRef} style={{ display: "flex", justifyContent: "center" }} />;
}

export default SpinningGlobe;
