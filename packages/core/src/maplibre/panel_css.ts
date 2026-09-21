export const PANEL_CSS = `
.svg-export-control button.svg-export-btn {
	background: none;
	border: none;
	cursor: pointer;
	padding: 5px;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 29px;
	height: 29px;
}

.svg-export-control button.svg-export-btn svg {
	width: 19px;
	height: 19px;
	fill: #333;
}

.svg-export-panel {
	position: absolute;
	top: 10px;
	right: 10px;
	background: #fff;
	border-radius: 8px;
	box-shadow: 0 2px 12px rgba(0,0,0,0.25);
	padding: 16px;
	z-index: 1000;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 13px;
	color: #333;
	min-width: 320px;
	max-width: 90vw;
	max-height: 90vh;
	overflow: auto;
}

.svg-export-panel .panel-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 12px;
}

.svg-export-panel .panel-header h3 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.svg-export-panel .panel-close {
	background: none;
	border: none;
	cursor: pointer;
	font-size: 18px;
	color: #666;
	padding: 2px 6px;
	border-radius: 4px;
}

.svg-export-panel .panel-close:hover {
	background: #f0f0f0;
}

.svg-export-panel .panel-inputs {
	margin-bottom: 12px;
}

.svg-export-panel .panel-inputs .grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	margin-bottom: 12px;
}

.svg-export-panel .panel-inputs label {
	font-size: 12px;
	color: #666;
}

.svg-export-panel .panel-inputs .grid label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	width: 100%;
}

.svg-export-panel .panel-inputs input {
	padding: 4px 8px;
	border: 1px solid #ccc;
	border-radius: 4px;
	font-size: 13px;
	box-sizing: border-box;
}

.svg-export-panel .preview-container {
	border: 1px solid #ddd;
	border-radius: 4px;
	overflow: hidden;
	margin-bottom: 12px;
	background: #f9f9f9;
	width: 320px;
	height: 240px;
	display: flex;
	align-items: center;
	justify-content: center;
}

.svg-export-panel .preview-container iframe {
	border: none;
	width: 100%;
	height: 100%;
	display: block;
}

.svg-export-panel .preview-loading {
	color: #999;
	font-size: 13px;
}

.svg-export-panel .panel-notice {
	font-size: 11px;
	color: #888;
	line-height: 1.4;
	margin-bottom: 12px;
	max-width: 320px;
}

.svg-export-panel .panel-notice a {
	color: inherit;
	text-decoration: underline;
}

.svg-export-panel .panel-notice a:hover {
	text-decoration: underline;
}

.svg-export-panel .panel-actions {
	display: flex;
	gap: 8px;
}

.svg-export-panel .panel-actions button {
	flex: 1;
	padding: 8px 12px;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 13px;
	font-weight: 500;
}

.svg-export-panel .btn-download {
	background: #4264fb;
	color: #fff;
}

.svg-export-panel .btn-download:hover {
	background: #3352d9;
}

.svg-export-panel .btn-download:disabled {
	background: #a0b0e0;
	cursor: not-allowed;
}

.svg-export-panel .btn-open {
	background: #555;
	color: #fff;
}

.svg-export-panel .btn-open:hover {
	background: #444;
}

.svg-export-panel .btn-open:disabled {
	background: #aaa;
	cursor: not-allowed;
}
`;
