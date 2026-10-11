declare const __ALFRED_BACKEND_ORIGIN__: string;
export const privateOrigin =
  typeof __ALFRED_BACKEND_ORIGIN__ === 'string' ? __ALFRED_BACKEND_ORIGIN__ : '';
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function backendOrigin(
  location: Pick<Location, 'protocol' | 'hostname' | 'port' | 'origin'>,
) {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/alfred/app/'))
    return location.origin + '/alfred';
  // Installed Even apps can use localhost as their asset host. Only our explicit
  // HTTP development ports may use the local Vite/setup proxy.
  const developmentHost =
    ['localhost', '127.0.0.1'].includes(location.hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(location.hostname);
  return location.protocol === 'http:' &&
    ['5173', '5174'].includes(location.port) &&
    developmentHost
    ? location.origin + '/alfred'
    : privateOrigin;
}
export async function readApiResponse(response: Response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Home Assistant returned an unreadable response (HTTP ${response.status}). Check your remote connection and HA server.`,
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof data.error === 'string'
        ? data.error
        : `Home Assistant rejected this request (HTTP ${response.status}).`,
    );
  return data;
}
