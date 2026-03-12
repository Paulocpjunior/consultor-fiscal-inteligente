
import React, { useEffect, useRef } from 'react';
import { Chart, registerables, ChartConfiguration, ChartTypeRegistry } from 'chart.js';

// Register Chart.js components
Chart.register(...registerables);

export interface SimpleChartProps {
    type: keyof ChartTypeRegistry;
    data: any;
    options?: any;
}

const SimpleChart: React.FC<SimpleChartProps> = ({ type, data, options }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        // Destroy previous instance
        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        // Create new chart
        chartRef.current = new Chart(ctx, {
            type,
            data,
            options
        } as ChartConfiguration);

        return () => {
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }
        };
    }, [type, data, options]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <canvas ref={canvasRef} />
        </div>
    );
};

export default SimpleChart;
