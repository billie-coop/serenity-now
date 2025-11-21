// Web app that uses ui, api-client, and utils
import { Button, DateDisplay } from '@example/ui';
import { ApiClient } from '@example/api-client';
import { capitalize } from '@example/utils';

const client = new ApiClient('https://api.example.com');

export async function renderApp() {
  const data = await client.get('/data');

  return `
    <div>
      <h1>${capitalize('welcome to the app')}</h1>
      ${DateDisplay(new Date())}
      ${Button('click me')}
      <pre>${JSON.stringify(data, null, 2)}</pre>
    </div>
  `;
}