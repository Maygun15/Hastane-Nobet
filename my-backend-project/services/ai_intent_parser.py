import os
from pydantic import BaseModel, Field
from typing import Literal, Optional, List
from openai import OpenAI

# OpenAI Client'ı başlatıyoruz. OPENAI_API_KEY ortam değişkeninden otomatik alınır.
client = OpenAI()

# 1. Adım: Çıkarılacak Varlıkların (Entities) Modellenmesi
class CommandEntities(BaseModel):
    person: Optional[str] = Field(None, description="İşlem yapılacak personelin adı ve soyadı")
    date: Optional[str] = Field(None, description="Tarih (YYYY-MM-DD formatında)")
    dateStart: Optional[str] = Field(None, description="Başlangıç tarihi (YYYY-MM-DD formatında)")
    dateEnd: Optional[str] = Field(None, description="Bitiş tarihi (YYYY-MM-DD formatında)")
    shiftCode: Optional[str] = Field(None, description="Vardiya veya nöbet kodu (Örn: GECE, SABAH, V1)")
    leaveType: Optional[str] = Field(None, description="İzin türü (Örn: YILLIK, HASTALIK, MAZERET)")
    serviceName: Optional[str] = Field(None, description="İlgili servis veya departman adı")

# 2. Adım: LLM'in Döneceği Ana Yapının (Intent) Modellenmesi
class ParsedIntent(BaseModel):
    intent: Literal[
        "assign_shift",
        "remove_shift",
        "add_leave",
        "remove_leave",
        "query_schedule",
        "query_person",
        "swap_shifts",
        "generate_schedule",
        "unknown"
    ] = Field(description="Kullanıcının yapmak istediği işlemin tipi")
    
    confidence: float = Field(description="Komutu anlama konusundaki güven skoru (0.0 ile 1.0 arası)")
    entities: CommandEntities = Field(description="Komuttan çıkarılan varlıklar")
    humanReadable: str = Field(description="Yapılacak işlemin asistan tarafından Türkçe, dostça ve kısa bir özeti")
    missingInfo: List[str] = Field(description="Eğer işlemi yapmak için eksik bilgi varsa burada belirtin (Örn: ['Tarih', 'Vardiya kodu'])")
    canExecute: bool = Field(description="Komut eksiksiz ve çalıştırılabilir durumda mı? Eksik bilgi yoksa True olmalıdır.")

# 3. Adım: Yapısal Çıktı (Structured Output) Çağrısı
def parse_hospital_command(user_input: str) -> ParsedIntent:
    """
    Kullanıcının doğal dil komutunu alır ve Pydantic modeli formatında kesin olarak döndürür.
    """
    
    system_prompt = """
    Sen bir hastane nöbet yönetim asistanısın. 
    Görevin doktor ve hemşirelerin nöbet ayarlamalarıyla ilgili Türkçe komutları çözümlemektir.
    Lütfen güncel yılı 2026 olarak kabul et.
    """

    # beta.chat.completions.parse metodunu kullanıyoruz
    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06", # Structured Outputs destekleyen bir model (veya gpt-4o-mini)
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input}
        ],
        # response_format'a doğrudan Pydantic sınıfımızı veriyoruz!
        response_format=ParsedIntent, 
        temperature=0.0 # Intent parsing için yaratıcılığı sıfırlıyoruz, deterministik olmalı.
    )

    # LLM cevabı doğrudan type-safe bir Pydantic nesnesi olarak döner
    parsed_data = response.choices[0].message.parsed
    return parsed_data

# --- Örnek Kullanım Testi ---
if __name__ == "__main__":
    test_command = "Ahmet Yılmaz'ı 15 Mayıs'taki V1 nöbetinden çıkarır mısın?"
    
    result = parse_hospital_command(test_command)
    
    print(f"Niyet (Intent): {result.intent}")
    print(f"Hedef Kişi: {result.entities.person}")
    print(f"Tarih: {result.entities.date}")
    print(f"Çalıştırılabilir mi?: {result.canExecute}")
    print(f"Açıklama: {result.humanReadable}")