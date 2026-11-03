// Contrato para uma integração futura. Nenhuma mensagem real é enviada no MVP.
export interface WhatsAppGateway {
  sendText(toE164: string, text: string): Promise<{ providerMessageId: string }>;
}
export interface IncomingWhatsAppMessage {
  providerMessageId: string;
  fromE164: string;
  text: string;
  receivedAt: Date;
}
