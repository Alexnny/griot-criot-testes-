// Apenas o servidor acessa a API Python privada. O dono vem da sessão autenticada.
export async function criotRequest(userId, route, method = 'GET', body) {
  if (process.env.CRIOT_ENABLED !== 'true') {
    throw Object.assign(new Error('Laboratório desativado. Use o deploy Docker indicado no guia.'), { status: 503 });
  }
  const port = Number(process.env.CRIOT_PORT || 8001);
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Criot-Owner': userId },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(135000)
    });
  } catch {
    throw Object.assign(new Error('API Criot indisponível ou demorando para responder. Tente novamente.'), { status: 503 });
  }
  const data = await response.json();
  if (!response.ok) {
    const message = typeof data.detail === 'string' ? data.detail : 'Dados inválidos para a API Criot.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}
