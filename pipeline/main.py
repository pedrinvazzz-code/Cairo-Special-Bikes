from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / '.env')

from extract import extract
from transform import transform
from load import load
from verificar import verificar
import traceback


def main():
    print("=" * 50)
    print("Cairo Bikes Pipeline — Iniciando")
    print("=" * 50)

    try:
        print("\n[1/4] Extraindo dados do Google Sheets...")
        dados_brutos = extract()

        print("\n[2/4] Transformando e validando...")
        dados_limpos = transform(dados_brutos)

        print("\n[3/4] Carregando no Supabase...")
        load(dados_limpos)

        print("\n[4/4] Verificando invariantes pós-carga...")
        verificar(dados_limpos)

        print("\n✅ Pipeline concluído com sucesso!")

    except Exception as e:
        print(f"\n❌ Erro no pipeline: {e}")
        traceback.print_exc()
        exit(1)


if __name__ == '__main__':
    main()
