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
        .range(["#e7f5f4", "#0d9588"]);

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

      // Globe background
      svg.append("circle")
        .attr("cx", width / 2).attr("cy", height / 2)
        .attr("r", projection.scale()!)
        .attr("fill", "#ffffff");

      // Graticule
      svg.append("path")
        .datum(d3.geoGraticule()())
        .attr("fill", "none")
        .attr("stroke", "#eceef1")
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
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 0.25)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .style("fill", (_d: any, i: number) => colorScale(20 + (i * 7) % 80))
        .attr("d", path as never);

      laneGroup.selectAll("path")
        .data(routesData)
        .enter().append("path")
        .attr("fill", "none")
        .attr("stroke", "#e5e7eb")
        .attr("stroke-width", 0.8)
        .attr("stroke-opacity", 0.5)
        .attr("d", path as never);

      const pulsePaths = pulseGroup.selectAll("path")
        .data(routesData)
        .enter().append("path")
        .attr("fill", "none")
        .attr("stroke", "#0d9488")
        .attr("stroke-width", 1.2)
        .attr("stroke-linecap", "round")
        .attr("stroke-opacity", 0.8)
        .attr("stroke-dasharray", "4, 120")
        .attr("d", path as never);

      const cityMarkers = cityGroup.selectAll("circle")
        .data(cities)
        .enter().append("circle")
        .attr("r", 2.2)
        .attr("fill", "#1a1a1a")
        .attr("opacity", 0.8);

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
      });

      return () => { timer.stop(); };
    })();

    return () => { cancelled = true; };
  }, [width, height]);

  return <div ref={containerRef} style={{ display: "flex", justifyContent: "center" }} />;
}

export default SpinningGlobe;
