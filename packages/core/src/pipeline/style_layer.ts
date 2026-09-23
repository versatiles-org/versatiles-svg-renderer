import {
	createVisibilityExpression,
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
	type StyleSpecification,
	type VisibilityExpression,
} from '@maplibre/maplibre-gl-style-spec';

/** Values of the style's global state, by name, as read by `global-state` expressions. */
export type GlobalState = Record<string, unknown>;

/**
 * The global state to render `style` with: the defaults of its `state`, overridden by
 * `overrides`, as `setGlobalStateProperty` does in MapLibre GL JS.
 */
export function getGlobalState(style: StyleSpecification, overrides?: GlobalState): GlobalState {
	const state: GlobalState = {};
	for (const [name, schema] of Object.entries(style.state ?? {})) state[name] = schema.default;
	return { ...state, ...overrides };
}

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
export class EvaluatedProperties {
	private readonly values: Record<string, unknown> = {};

	get(name: string): unknown {
		return this.values[name];
	}

	set(name: string, value: unknown): void {
		this.values[name] = value;
	}
}

/** A layer's paint and layout properties, evaluated for one zoom level. */
export interface EvaluatedLayer {
	paint: EvaluatedProperties;
	layout: EvaluatedProperties;
}

/**
 * Lightweight style layer that evaluates paint/layout properties
 * using normalizePropertyExpression from @maplibre/maplibre-gl-style-spec.
 *
 * Replaces the full maplibre style layer pipeline (Transitionable -> Transitioning
 * -> PossiblyEvaluated) with a direct evaluation approach, since we don't need
 * animation transitions.
 *
 * A StyleLayer holds only what depends on the style, so one instance can be shared by
 * concurrent renders: {@link StyleLayer.evaluate} returns the zoom-dependent values instead
 * of storing them.
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

	private readonly paintExpressions: Map<string, StylePropertyExpression>;
	private readonly layoutExpressions: Map<string, StylePropertyExpression>;
	private readonly visibility: VisibilityExpression;

	/**
	 * @param globalState - The values `global-state` expressions read, in the layer's
	 *   properties, filter and visibility.
	 */
	constructor(spec: LayerSpecification, globalState: GlobalState = {}) {
		this.id = spec.id;
		this.type = spec.type;
		this.minzoom = spec.minzoom;
		this.maxzoom = spec.maxzoom;
		this.paintExpressions = new Map();
		this.layoutExpressions = new Map();

		if (spec.type !== 'background') {
			this.source = (spec as Record<string, unknown>).source as string;
			this.sourceLayer = (spec as Record<string, unknown>)['source-layer'] as string;
			this.filter = (spec as Record<string, unknown>).filter as FilterSpecification | undefined;
			this.filterFn = featureFilter(this.filter, `layers.${this.id}.filter`, globalState);
		}

		this.visibility = createVisibilityExpression(
			spec.layout?.visibility ?? 'visible',
			`layers.${this.id}.layout.visibility`,
			globalState,
		);

		// Initialize paint property expressions
		const paintSpec = (
			latest as unknown as Record<string, Record<string, StylePropertySpecification> | undefined>
		)[`paint_${spec.type}`];
		if (paintSpec) {
			const paintValues: Record<string, unknown> = spec.paint ?? {};
			for (const [name, propSpec] of Object.entries(paintSpec)) {
				const raw = paintValues[name];
				const value = raw === undefined ? propSpec.default : raw;
				this.paintExpressions.set(
					name,
					normalizePropertyExpression(value, name, propSpec, globalState),
				);
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
				this.layoutExpressions.set(
					name,
					normalizePropertyExpression(value, name, propSpec, globalState),
				);
			}
		}
	}

	isHidden(zoom: number): boolean {
		if (this.minzoom != null && zoom < this.minzoom) return true;
		if (this.maxzoom != null && zoom >= this.maxzoom) return true;
		return this.visibility.evaluate() === 'none';
	}

	evaluate(params: { zoom: number }, availableImages: string[]): EvaluatedLayer {
		return {
			paint: evaluateExpressions(this.paintExpressions, params, availableImages),
			layout: evaluateExpressions(this.layoutExpressions, params, availableImages),
		};
	}
}

/**
 * Evaluates zoom-only expressions right away and wraps data-driven ones for per-feature
 * evaluation.
 */
function evaluateExpressions(
	expressions: Map<string, StylePropertyExpression>,
	params: { zoom: number },
	availableImages: string[],
): EvaluatedProperties {
	const properties = new EvaluatedProperties();
	for (const [name, expr] of expressions) {
		if (expr.kind === 'constant' || expr.kind === 'camera') {
			properties.set(name, expr.evaluate(params, undefined, {}, undefined, availableImages));
		} else {
			properties.set(name, new PossiblyEvaluatedPropertyValue(expr, params));
		}
	}
	return properties;
}

export function createStyleLayer(spec: LayerSpecification, globalState?: GlobalState): StyleLayer {
	return new StyleLayer(spec, globalState);
}

export function getLayerStyles(
	layers: LayerSpecification[],
	globalState?: GlobalState,
): StyleLayer[] {
	return layers.map((spec) => createStyleLayer(spec, globalState));
}
