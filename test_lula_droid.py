"""Teste do Lula Droid: wake word, opinião e memória adaptável."""
import json
from datetime import datetime
from ai_call import (
    process_audio_chunk, get_recent_transcript, generate_opinion,
    clear_call, get_memory_summary, detect_wake_word
)

LOG = []
def log(msg, data=None):
    e = {"t": datetime.now().isoformat(timespec="seconds"), "msg": msg}
    if data: e["data"] = data
    LOG.append(e)
    print(f"[{e['t']}] {msg}")

def main():
    call_id = "lula-test-001"
    clear_call(call_id)
    log("Teste Lula Droid iniciado")

    # Falas normais
    process_audio_chunk(call_id, "u1", "Ana", {"sample_text": "Acho que o projeto está indo bem."})
    process_audio_chunk(call_id, "u2", "Bruno", {"sample_text": "Concordo, mas precisamos de mais testes."})

    # Wake word
    woke, cmd = detect_wake_word("Ei Lula Droid, o que você acha do andamento?")
    log("Wake word detectado", {"woke": woke, "command": cmd})

    result = process_audio_chunk(
        call_id, "u1", "Ana",
        {"sample_text": "Ei Lula Droid, pesquise sobre as melhores práticas de transcrição em tempo real."}
    )
    log("Resposta após wake word", {
        "wake": result.get("wake"),
        "ai": result.get("ai_response", {}).get("answer", "")[:150]
    })

    # Memória
    process_audio_chunk(call_id, "u2", "Bruno", {"sample_text": "Eu prefiro respostas curtas e diretas."})
    mem = get_memory_summary()
    log("Memória adaptável", mem)

    log("Teste concluído")
    out = "/workspace/artifacts/lula_droid_test_log.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"test": "Lula Droid - Grok + memória", "entries": LOG}, f, ensure_ascii=False, indent=2)
    print(f"Log: {out}")

if __name__ == "__main__":
    main()
