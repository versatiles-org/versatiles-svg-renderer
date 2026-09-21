import {
	normalizePropertyExpression,
	featureFilter,
	latest,
	type LayerSpecification,
	type FilterSpecification,
	type Feature,
	type FeatureState,
	type StylePropertyExpression,
	type StylePropertySpecification,
	type ICanonicalTileID,
} from '@maplibre/maplibre-gl-style-spec';

/**
 * Wraps a source/composite expression for per-feature evaluation.
 */
export class PossiblyEvaluatedPropertyValue<T> {
	private readonly expression: StylePropertyExpression;
	private readonly globals: { zoom: number };

	constructor(expression: StylePropertyExpression, globals: { zoom: number }) {
		this.expression = expression;
		this.globals = globals;
	}

	evaluate(
		feature: Feature,
		featureState: FeatureState,
		canonical?: ICanonicalTileID,
		availableImages?: string[],
	): T {
		return this.expression.evaluate(
			this.globals,
			feature,
			featureState,
			canonical,
			availableImages,
		) as T;
	}
}

/**
 * Container for evaluated property values with a get(name) accessor.
 */
class EvaluatedProperties {
	private readonly values: Record<string, unknown> = {};

	get(name: string): unknown {
		return this.values[name];
	}

	set(name: string, value: unknown): void {
		this.values[name] = value;
	}
}

/**
 * Lightweight style layer that evaluates paint/layout properties
 * using normalizePropertyExpression from @maplibre/maplibre-gl-style-spec.
 *
 * Replaces the full maplibre style layer pipeline (Transitionable -> Transitioning
 * -> PossiblyEvaluated) with a direct evaluation approach, since we don't need
 * animation transitions.
 */
export class StyleLayer {
	readonly id: string;
	readonly type: LayerSpecification['type'];
	readonly source!: string;
	readonly sourceLayer!: string;
	readonly minzoom: number | undefined;
	readonly maxzoom: number | undefined;
	readonly filter: FilterSpecification | undefined;
	readonly filterFn: ReturnType<typeof featureFilter> | undefined;
	paint: EvaluatedProperties;
	layout: EvaluatedProperties;

	private readonly paintExpressions: Map<string, StylePropertyExpression>;
	private readonly layoutExpressions: Map<string, StylePropertyExpression>;
	private readonly visibility: string;

	constructor(spec: LayerSpecification) {
		this.id = spec.id;
		this.type = spec.type;
		this.minzoom = spec.minzoom;
		this.maxzoom = spec.maxzoom;
		this.paint = new EvaluatedProperties();
		this.layout = new EvaluatedProperties();
		this.paintExpressions = new Map();
		this.layoutExpressions = new Map();

		if (spec.type !== 'background') {
			this.source = (spec as Record<string, unknown>).source as string;
			this.sourceLayer = (spec as Record<string, unknown>)['source-layer'] as string;
			this.filter = (spec as Record<string, unknown>).filter as FilterSpecification | undefined;
			this.filterFn = featureFilter(this.filter, `layers.${this.id}.filter`);
		}

		this.visibility = (spec.layout?.visibility ?? 'visible') as string;

		// Initialize paint property expressions
		const paintSpec = (
			latest as unknown as Record<string, Record<string, StylePropertySpecification> | undefined>
		)[`paint_${spec.type}`];
		if (paintSpec) {
			const paintValues: Record<string, unknown> = spec.paint ?? {};
			for (const [name, propSpec] of Object.entries(paintSpec)) {
				const raw = paintValues[name];
				const value = raw === undefined ? propSpec.default : raw;
				this.paintExpressions.set(name, normalizePropertyExpression(value, name, propSpec));
			}
		}

		// Initialize layout property expressions (skip visibility, handled separately)
		const layoutSpec = (
			latest as unknown as Record<string, Record<string, StylePropertySpecification> | undefined>
		)[`layout_${spec.type}`];
		if (layoutSpec) {
			const layoutValues = (spec.layout ?? {}) as Record<string, unknown>;
			for (const [name, propSpec] of Object.entries(layoutSpec)) {
				if (name === 'visibility') continue;
				const raw = layoutValues[name];
				const value = raw === undefined ? propSpec.default : raw;
				this.layoutExpressions.set(name, normalizePropertyExpression(value, name, propSpec));
			}
		}
	}

	isHidden(zoom: number): boolean {
		if (this.minzoom != null && zoom < this.minzoom) return true;
		if (this.maxzoom != null && zoom >= this.maxzoom) return true;
		return this.visibility === 'none';
	}

	recalculate(params: { zoom: number }, availableImages: string[]): void {
		this.paint = new EvaluatedProperties();
		this.layout = new EvaluatedProperties();

		for (const [name, expr] of this.paintExpressions) {
			if (expr.kind === 'constant' || expr.kind === 'camera') {
				this.paint.set(name, expr.evaluate(params, undefined, {}, undefined, availableImages));
			} else {
				this.paint.set(name, new PossiblyEvaluatedPropertyValue(expr, params));
			}
		}

		for (const [name, expr] of this.layoutExpressions) {
			if (expr.kind === 'constant' || expr.kind === 'camera') {
				this.layout.set(name, expr.evaluate(params, undefined, {}, undefined, availableImages));
			} else {
				this.layout.set(name, new PossiblyEvaluatedPropertyValue(expr, params));
			}
		}
	}
}

export function createStyleLayer(spec: LayerSpecification): StyleLayer {
	return new StyleLayer(spec);
}

export function getLayerStyles(layers: LayerSpecification[]): StyleLayer[] {
	return layers.map(createStyleLayer);
}
