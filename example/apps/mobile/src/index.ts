// Mobile app that uses ui and api-client

import { ApiClient } from "@example/api-client";
import { Button } from "@example/ui";

const client = new ApiClient("https://api.example.com");

export class MobileApp {
	async initialize() {
		const userData = await client.get("/user");
		console.log("User:", userData);
	}

	renderButton(text: string) {
		return Button(text);
	}
}
