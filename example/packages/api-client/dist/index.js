// API client that uses utils
import { debounce } from '@example/utils';
export class ApiClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    // Debounced search method
    search = debounce(async (query) => {
        const response = await fetch(`${this.baseUrl}/search?q=${query}`);
        return response.json();
    }, 300);
    async get(path) {
        const response = await fetch(`${this.baseUrl}${path}`);
        return response.json();
    }
}
//# sourceMappingURL=index.js.map