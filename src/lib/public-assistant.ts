import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase.ts';

const functions = getFunctions(app);

export async function improvePublicAssistantContext(
  businessId: string,
  context: string,
): Promise<string> {
  const request = httpsCallable<{ businessId: string; context: string }, { context: string }>(
    functions,
    'improvePublicAssistantContext',
  );
  const response = await request({ businessId, context });
  return response.data.context;
}

export async function askPublicBusinessAssistant(slug: string, question: string): Promise<string> {
  const request = httpsCallable<{ slug: string; question: string }, { answer: string }>(
    functions,
    'askPublicBusinessAssistant',
  );
  const response = await request({ slug, question });
  return response.data.answer;
}
