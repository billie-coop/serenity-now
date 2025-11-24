// API client that uses utils
import { debounce } from "@example/utils";

export class ApiClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl;
	}

	// Debounced search method
	search = debounce(async (query: string) => {
		const response = await fetch(`${this.baseUrl}/search?q=${query}`);
		return response.json();
	}, 300);

	async get(path: string) {
		const response = await fetch(`${this.baseUrl}${path}`);
		return response.json();
	}
}
