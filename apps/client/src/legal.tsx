import type { Locale, Route } from "./types";
import { termsVersion } from "./legal-version";

type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalDocument = {
  title: string;
  intro: string;
  sections: LegalSection[];
};

type LegalCopy = {
  updated: string;
  nav: { terms: string; returns: string; privacy: string };
  merchantTitle: string;
  merchantIntro: string;
  missingTitle: string;
  missingBody: string;
  notProvided: string;
  fields: {
    businessName: string;
    registrationNumber: string;
    taxID: string;
    vatStatus: string;
    registeredAddress: string;
    restaurantAddress: string;
    email: string;
    phone: string;
    registry: string;
    support: string;
  };
  terms: LegalDocument;
  returns: LegalDocument;
  privacy: LegalDocument;
};

const ownerLegalDefaults = {
  businessName: "Siarhei Dashchynski pr Ugostiteljska radnja TAKO LAKO Novi Sad",
  registrationNumber: "68187907",
  taxID: "115213491",
  vatStatus: "Nije u sistemu PDV-a",
  registeredAddress: "Koste Abraševića 49, 21000 Novi Sad, Republika Srbija",
  restaurantAddress: "Novi Sad, Republika Srbija",
  email: "takolako1ns@gmail.com",
  phone: "+381 61 731 7538",
};

export const legalProfile = {
  businessName: publicValue(import.meta.env.VITE_LEGAL_BUSINESS_NAME, ownerLegalDefaults.businessName),
  registrationNumber: publicValue(import.meta.env.VITE_LEGAL_REGISTRATION_NUMBER, ownerLegalDefaults.registrationNumber),
  taxID: publicValue(import.meta.env.VITE_LEGAL_TAX_ID, ownerLegalDefaults.taxID),
  vatStatus: publicValue(import.meta.env.VITE_LEGAL_VAT_STATUS, ownerLegalDefaults.vatStatus),
  registeredAddress: publicValue(import.meta.env.VITE_LEGAL_REGISTERED_ADDRESS, ownerLegalDefaults.registeredAddress),
  restaurantAddress: publicValue(import.meta.env.VITE_LEGAL_RESTAURANT_ADDRESS, ownerLegalDefaults.restaurantAddress),
  email: publicValue(import.meta.env.VITE_LEGAL_EMAIL, ownerLegalDefaults.email),
  phone: publicValue(import.meta.env.VITE_LEGAL_PHONE, ownerLegalDefaults.phone),
  supportTelegram: "@Tako_Lako",
};

const legalCopy: Record<Locale, LegalCopy> = {
  sr: {
    updated: "Datum primene: 27.08.2026. · verzija 2026-08-27",
    nav: { terms: "Uslovi prodaje", returns: "Reklamacije i povraćaj", privacy: "Privatnost" },
    merchantTitle: "Podaci o prodavcu",
    merchantIntro: "Tako Lako je naziv prodajnog mesta. Ugovorna strana i rukovalac podacima je preduzetnik naveden ispod.",
    missingTitle: "Obavezni podaci prodavca još nisu objavljeni",
    missingBody: "Pre uključenja kartičnog plaćanja moraju se uneti puno poslovno ime iz APR-a, matični broj, PIB, adresa, e-mail i telefon. Dok ti podaci nedostaju, ovaj dokument je nacrt i nije spreman za proveru banke ili prihvatioca kartica.",
    notProvided: "nije uneto",
    fields: {
      businessName: "Poslovno ime",
      registrationNumber: "Matični broj",
      taxID: "PIB",
      vatStatus: "PDV status",
      registeredAddress: "Sedište",
      restaurantAddress: "Adresa objekta",
      email: "E-mail za kontakt i reklamacije",
      phone: "Telefon",
      registry: "Registar",
      support: "Telegram podrška",
    },
    terms: {
      title: "Uslovi prodaje i dostave",
      intro: "Ovi uslovi uređuju poručivanje, plaćanje i dostavu hrane putem Tako Lako Telegram Mini App-a. Kupac ih može sačuvati ili odštampati pre slanja porudžbine.",
      sections: [
        {
          id: "scope",
          title: "1. Prodajno mesto i primena uslova",
          paragraphs: [
            "Prodavac priprema i dostavlja hranu u Novom Sadu, u području u kojem je dostava dostupna u trenutku poručivanja. Uslovi važe za potrošače koji porudžbinu šalju putem Tako Lako aplikacije.",
            "Za porudžbinu važi verzija uslova prikazana kupcu neposredno pre slanja porudžbine. Prinudni propisi Republike Srbije imaju prednost nad ovim uslovima.",
          ],
        },
        {
          id: "order",
          title: "2. Zaključenje ugovora i potvrda porudžbine",
          bullets: [
            "Kupac bira proizvode i količinu, unosi telefon i adresu, bira ponuđeni način plaćanja i proverava konačan pregled porudžbine.",
            "Cene, trošak dostave, ukupan iznos, način plaćanja i podaci za dostavu prikazuju se pre dugmeta za slanje porudžbine.",
            "Porudžbina je prihvaćena kada aplikacija prikaže njen broj i status da je prihvaćena. Kod onlajn plaćanja to se dešava tek nakon serverske potvrde uspešne uplate.",
            "Ako proizvod nije dostupan ili dostava objektivno nije moguća, prodavac će bez odlaganja obavestiti kupca i ponuditi izmenu ili otkazivanje; već naplaćen iznos vraća se u celosti.",
          ],
        },
        {
          id: "prices",
          title: "3. Cene i dostava",
          paragraphs: [
            "Sve cene su konačne potrošačke cene u dinarima (RSD). Prodavac nije u sistemu PDV-a. Dostava je besplatna i nema minimalne vrednosti porudžbine. Prodavac ne menja cenu nakon prihvatanja porudžbine bez izričite saglasnosti kupca.",
            "Kupac odgovara za tačnost telefona i tekstualne adrese. Dostava se vrši tokom objavljenog radnog vremena. Okvirni rok dostave je od 5 do 60 minuta od završetka pripreme hrane, u zavisnosti od adrese, opterećenja i saobraćaja. Ako taj rok nije moguć, prodavac kontaktira kupca radi dogovora o novom roku ili otkazivanju bez troška za kupca.",
          ],
        },
        {
          id: "payment",
          title: "4. Načini i bezbednost plaćanja",
          bullets: [
            "Dostupni su samo načini plaćanja prikazani u završnom koraku poručivanja. Dok kartice nisu aktivirane, stvarne porudžbine plaćaju se gotovinom pri dostavi.",
            "Kada kartice budu aktivirane, kartični podaci unose se isključivo na zaštićenoj stranici ugovorenog pružaoca platnih usluga. Tako Lako ne prima niti čuva broj kartice, datum važenja ili CVV/CVC.",
            "Kartična porudžbina smatra se plaćenom samo posle potvrde pružaoca platnih usluga. Povratak na stranicu sa porukom o uspehu sam po sebi nije dokaz plaćanja.",
            "Plaćanje se obračunava u RSD. Banka izdavalac kartice može primeniti konverziju ili svoju naknadu ako je račun kupca u drugoj valuti.",
          ],
        },
        {
          id: "receipt",
          title: "5. Fiskalni račun",
          paragraphs: [
            "Prodavac evidentira promet i izdaje fiskalni račun u skladu sa propisima Republike Srbije. Kupac račun dobija uz dostavu ili elektronskim putem kada su za to ispunjeni zakonski uslovi.",
          ],
        },
        {
          id: "food",
          title: "6. Hrana, deklaracije i alergeni",
          paragraphs: [
            "Fotografije su ilustrativne; manja odstupanja u izgledu ne utiču na saobraznost ako sastav i poručeni proizvod odgovaraju opisu. Dostupni podaci o sastavu, količini i alergenima prikazuju se uz proizvod ili se mogu dobiti od podrške pre poručivanja.",
            "Slobodan komentar uz porudžbinu nije garancija da će alergen biti isključen. Kupac sa alergijom treba pre slanja porudžbine da kontaktira podršku i proveri da li je bezbedna priprema moguća.",
          ],
        },
        {
          id: "cancellation",
          title: "7. Otkazivanje i pravo na odustanak",
          paragraphs: [
            "Nakon prihvatanja porudžbine kupac ne može jednostrano otkazati porudžbinu, jer priprema hrane može početi odmah. Ako kupac odmah kontaktira podršku pre početka pripreme, prodavac može potvrditi izuzetno otkazivanje; bez takve potvrde porudžbina ostaje aktivna.",
            "Zakonsko pravo na odustanak od ugovora na daljinu u roku od 14 dana ne primenjuje se na robu koja je podložna pogoršanju kvaliteta ili ima kratak rok trajanja, kao ni na robu proizvedenu prema posebnim zahtevima potrošača. Ovo ne ograničava prava kupca kada je hrana pogrešna, nebezbedna, nesaobrazna ili nije isporučena.",
          ],
        },
        {
          id: "complaints",
          title: "8. Reklamacije, povraćaj i sporovi",
          paragraphs: [
            "Postupak reklamacije, rokovi i način povraćaja detaljno su opisani na posebnoj stranici „Reklamacije i povraćaj“, koja čini sastavni deo ovih uslova.",
            "Ako spor nije rešen direktno, potrošač može pokrenuti vansudsko rešavanje potrošačkog spora pred nadležnim telom. Prodavac je dužan da učestvuje u postupku kada su ispunjeni zakonski uslovi. Za sporove se primenjuje pravo Republike Srbije i nadležnost određena zakonom.",
          ],
        },
        {
          id: "contact",
          title: "9. Kontakt i izmene",
          paragraphs: [
            "Pitanja o porudžbini, uslovima ili podacima mogu se poslati na objavljeni e-mail, telefon ili Telegram podršku. Izmene uslova važe samo za buduće porudžbine i objavljuju se sa novim datumom i verzijom.",
          ],
        },
      ],
    },
    returns: {
      title: "Reklamacije, otkazivanje i povraćaj",
      intro: "Ova pravila objašnjavaju kako kupac prijavljuje problem sa hranom, dostavom ili naplatom i kako se obrađuje povraćaj.",
      sections: [
        {
          id: "submit",
          title: "1. Kako podneti reklamaciju",
          paragraphs: ["Reklamacija se podnosi putem objavljenog e-maila, Telegram podrške, telefonom ili na adresi prodavca. Za najbržu obradu navedite broj porudžbine, datum, opis problema, željeno rešenje i, kada je korisno, fotografiju. Reklamacije obrađuje menadžer prodavca. Fiskalni račun nije jedini dozvoljeni dokaz kupovine."],
        },
        {
          id: "deadlines",
          title: "2. Potvrda i rokovi",
          bullets: [
            "Prodavac bez odlaganja potvrđuje prijem reklamacije i saopštava evidencioni broj.",
            "Pisani ili elektronski odgovor dostavlja se najkasnije u roku od osam dana od prijema reklamacije.",
            "Prihvaćena reklamacija rešava se u dogovorenom roku, koji za ovu vrstu robe ne može biti duži od zakonskog roka od 15 dana.",
            "Evidencija primljenih reklamacija čuva se najmanje dve godine.",
          ],
        },
        {
          id: "remedies",
          title: "3. Moguća rešenja",
          paragraphs: ["U zavisnosti od okolnosti i izbora koji zakon daje kupcu, rešenje može biti isporuka odgovarajućeg proizvoda, umanjenje cene ili puni povraćaj. Zbog prirode pripremljene hrane zamena se nudi samo kada je bezbedna i ima smisla za kupca."],
        },
        {
          id: "refund",
          title: "4. Način povraćaja",
          bullets: [
            "Kod gotovinskog plaćanja način vraćanja novca dogovara se sa kupcem.",
            "Kod kartičnog plaćanja povraćaj se pokreće na istu karticu preko pružaoca platnih usluga; povraćaj se ne isplaćuje u gotovini.",
            "Prodavac potvrđuje kada je povraćaj pokrenut. Vreme knjiženja nakon toga zavisi od pružaoca platnih usluga i banke izdavaoca kartice.",
            "Duplo terećenje, potvrđeno plaćanje bez formirane porudžbine ili otkazana već plaćena porudžbina proveravaju se sa pružaocem platnih usluga i, kada je naplata potvrđena, vraćaju u celosti.",
          ],
        },
        {
          id: "chargeback",
          title: "5. Neovlašćena transakcija i chargeback",
          paragraphs: ["Sumnju na neovlašćenu kartičnu transakciju kupac treba odmah da prijavi banci izdavaocu kartice i prodavcu. Chargeback postupak vodi banka prema pravilima kartične šeme; on ne zamenjuje pravo kupca da se prvo obrati prodavcu."],
        },
      ],
    },
    privacy: {
      title: "Obaveštenje o privatnosti",
      intro: "Ovo obaveštenje opisuje koje podatke obrađujemo kada koristite Tako Lako aplikaciju, zašto ih koristimo, kome ih otkrivamo i koja prava imate.",
      sections: [
        {
          id: "data",
          title: "1. Podaci koje obrađujemo",
          bullets: [
            "Telegram identifikator i javni podaci profila potrebni za prijavu i povezivanje porudžbine sa kupcem.",
            "Potvrđen broj telefona, tekstualna adresa, komentar, jezik i istorija porudžbina.",
            "Sadržaj porudžbine, iznosi, status dostave, izabrani način i status plaćanja, reklamacije i komunikacija sa podrškom.",
            "Tehnički podaci potrebni za bezbednost i rad sistema, kao što su vreme zahteva, IP adresa i bezbednosni događaji. Telegram initData proverava se na serveru i ne upisuje se u logove.",
            "Kod provere lokacije za gotovinsku porudžbinu ne čuvamo tačne koordinate; čuvamo rezultat provere, udaljenost, tačnost, vreme i razlog odbijanja.",
            "Podaci o korišćenju aplikacije: otvoreni ekrani i pritisci na dugmad ili linkove. Sadržaj polja, telefon, adresa, koordinate i Telegram initData ne ulaze u analitičke događaje.",
          ],
        },
        {
          id: "purpose",
          title: "2. Svrhe i pravni osnov",
          bullets: [
            "Izvršenje ugovora: obračun, prihvatanje, priprema, dostava, podrška i povraćaj.",
            "Zakonske obaveze: fiskalni i računovodstveni dokumenti, reklamacije i odgovor nadležnim organima.",
            "Legitimni interes: sprečavanje zloupotrebe, bezbednost sistema, dokazivanje transakcije, poboljšanje upotrebljivosti aplikacije i rešavanje sporova, uz zaštitu prava kupca.",
          ],
        },
        {
          id: "sharing",
          title: "3. Primaoci podataka",
          paragraphs: ["Podatke dobijaju samo lica kojima su potrebni: ovlašćeno osoblje prodavca, jedini kurir za konkretnu dostavu, ugovoreni hosting i IT dobavljači, pružalac platnih usluga i banka kada je izabrano onlajn plaćanje, kao i državni organ kada zakon to zahteva. Kurir dobija samo podatke potrebne za dostavu."],
          bullets: [
            "Podaci kartice unose se kod pružaoca platnih usluga i ne prolaze kroz Tako Lako server.",
            "Telegram obrađuje podatke u okviru svoje platforme prema sopstvenim pravilima privatnosti. Tako Lako ne kontroliše Telegram nalog ili infrastrukturu.",
            "Podaci se ne prodaju i ne koriste za profilisano oglašavanje.",
          ],
        },
        {
          id: "retention",
          title: "4. Rok čuvanja i bezbednost",
          paragraphs: ["Podatke čuvamo samo koliko je potrebno za navedene svrhe: poslovnu i fiskalnu dokumentaciju u rokovima propisanim zakonom, evidenciju reklamacija najmanje dve godine, analitičke događaje najduže 400 dana, a bezbednosne podatke u ograničenom periodu potrebnom za zaštitu sistema i rešavanje incidenta. Po isteku roka podaci se brišu ili anonimizuju kada ne postoji drugi pravni osnov."],
          bullets: [
            "Telefon i adresa čuvaju se šifrovano, pristup je ograničen ulogom zaposlenog, a osetljivi podaci se ne upisuju u aplikacione logove.",
            "Korpa u uređaju sadrži samo identifikatore proizvoda, prikazane podatke i količine; ne sadrži telefon, adresu, sesiju ili Telegram initData.",
          ],
        },
        {
          id: "rights",
          title: "5. Prava lica",
          paragraphs: ["Kupac može zatražiti pristup, ispravku, brisanje ili ograničenje obrade, uložiti prigovor kada se obrada zasniva na legitimnom interesu i zatražiti prenosivost kada su ispunjeni zakonski uslovi. Zahtev se šalje na objavljeni e-mail. Pre odgovora možemo tražiti razumnu proveru identiteta."],
          bullets: [
            "Brisanje nije moguće za podatke koje prodavac i dalje mora da čuva zbog fiskalnih, računovodstvenih, potrošačkih ili sudskih obaveza.",
            "Pritužba se može podneti Povereniku za informacije od javnog značaja i zaštitu podataka o ličnosti: poverenik.rs.",
          ],
        },
      ],
    },
  },
  ru: {
    updated: "Дата применения: 27.08.2026 · версия 2026-08-27",
    nav: { terms: "Условия продажи", returns: "Претензии и возврат", privacy: "Конфиденциальность" },
    merchantTitle: "Данные продавца",
    merchantIntro: "Tako Lako — название торговой точки. Стороной договора и оператором персональных данных является указанный ниже предприниматель.",
    missingTitle: "Обязательные данные продавца ещё не опубликованы",
    missingBody: "До подключения оплаты картой нужно указать полное наименование ИП из APR, регистрационный номер, PIB, адрес, email и телефон. Пока этих данных нет, документ считается проектом и не готов к проверке банком или эквайером.",
    notProvided: "не заполнено",
    fields: {
      businessName: "Полное наименование ИП",
      registrationNumber: "Регистрационный номер (matični broj)",
      taxID: "PIB",
      vatStatus: "Статус PDV",
      registeredAddress: "Юридический адрес",
      restaurantAddress: "Адрес ресторана",
      email: "Email для связи и претензий",
      phone: "Телефон",
      registry: "Реестр",
      support: "Поддержка в Telegram",
    },
    terms: {
      title: "Условия продажи и доставки",
      intro: "Эти условия регулируют заказ, оплату и доставку еды через Telegram Mini App Tako Lako. До отправки заказа покупатель может сохранить или распечатать документ.",
      sections: [
        { id: "scope", title: "1. Продавец и применение условий", paragraphs: ["Продавец готовит и доставляет еду в Нови-Саде, на территории, где доставка доступна в момент заказа. Условия применяются к потребителям, оформляющим заказ через приложение Tako Lako.", "К заказу применяется версия условий, показанная непосредственно перед его отправкой. Императивные нормы Республики Сербии имеют приоритет."] },
        { id: "order", title: "2. Заключение договора и подтверждение заказа", bullets: ["Покупатель выбирает товары и количество, указывает телефон и адрес, выбирает доступный способ оплаты и проверяет итоговый состав заказа.", "Цены, стоимость доставки, итоговая сумма, способ оплаты и адрес показываются до кнопки отправки заказа.", "Заказ принят, когда приложение показывает его номер и статус принятия. При онлайн-оплате это происходит только после серверного подтверждения платежа.", "Если товар недоступен или доставка объективно невозможна, продавец сразу предлагает изменить или отменить заказ; уже списанная сумма возвращается полностью."] },
        { id: "prices", title: "3. Цены и доставка", paragraphs: ["Все цены — конечные потребительские цены в сербских динарах (RSD). Продавец не находится в системе PDV. Доставка бесплатная, минимального заказа нет. После принятия заказа цена не меняется без явного согласия покупателя.", "Покупатель отвечает за правильность телефона и адреса. Доставка выполняется в опубликованные часы работы. Ориентировочный срок доставки — от 5 до 60 минут с момента приготовления еды, в зависимости от адреса, загрузки и дорожной ситуации. Если этот срок невозможен, продавец связывается с покупателем и согласует новый срок либо отмену без расходов для покупателя."] },
        { id: "payment", title: "4. Способы и безопасность оплаты", bullets: ["Доступны только способы оплаты, показанные при оформлении. Пока карты не активированы, реальные заказы оплачиваются наличными при доставке.", "После подключения карт их данные вводятся только на защищённой странице договорного платёжного провайдера. Tako Lako не получает и не хранит номер карты, срок действия или CVV/CVC.", "Карточный заказ считается оплаченным только после подтверждения провайдера на сервере. Возврат на страницу с сообщением об успехе сам по себе не подтверждает оплату.", "Оплата проводится в RSD. Банк-эмитент может применить конвертацию или свою комиссию для счёта в другой валюте."] },
        { id: "receipt", title: "5. Фискальный чек", paragraphs: ["Продавец регистрирует продажу и выдаёт фискальный чек по правилам Республики Сербии. Покупатель получает чек вместе с доставкой либо в электронной форме, когда это разрешено законом."] },
        { id: "food", title: "6. Еда, сведения о товаре и аллергены", paragraphs: ["Фотографии имеют иллюстративный характер; небольшие отличия внешнего вида не означают несоответствие, если состав и заказанный товар соответствуют описанию. Сведения о составе, количестве и аллергенах показываются у товара либо предоставляются поддержкой до заказа.", "Свободный комментарий к заказу не гарантирует исключения аллергена. Покупателю с аллергией следует до отправки заказа уточнить у поддержки, возможна ли безопасная подготовка."] },
        { id: "cancellation", title: "7. Отмена и отказ от дистанционного договора", paragraphs: ["После принятия заказа покупатель не может односторонне отменить заказ, потому что приготовление еды может начаться сразу. Если покупатель немедленно свяжется с поддержкой до начала приготовления, продавец может подтвердить исключительную отмену; без такого подтверждения заказ остаётся активным.", "Право на отказ от дистанционного договора в течение 14 дней не распространяется на скоропортящиеся товары и товары с коротким сроком годности, а также изготовленные по индивидуальным требованиям. Это не ограничивает права покупателя, если еда неверная, небезопасная, не соответствует заказу или не доставлена."] },
        { id: "complaints", title: "8. Претензии, возвраты и споры", paragraphs: ["Порядок претензии, сроки и способ возврата описаны на отдельной странице «Претензии и возврат», являющейся частью этих условий.", "Если спор не решён напрямую, потребитель вправе обратиться к процедуре внесудебного разрешения потребительского спора. Продавец участвует в ней в предусмотренных законом случаях. Применяется право Республики Сербии, подсудность определяется законом."] },
        { id: "contact", title: "9. Контакты и изменения", paragraphs: ["Вопросы по заказу, условиям или данным можно направить на опубликованный email, телефон или в Telegram. Изменения условий действуют только для будущих заказов и публикуются с новой датой и версией."] },
      ],
    },
    returns: {
      title: "Претензии, отмена и возврат денег",
      intro: "Здесь описано, как сообщить о проблеме с едой, доставкой или списанием и как выполняется возврат.",
      sections: [
        { id: "submit", title: "1. Как подать претензию", paragraphs: ["Претензию можно направить на опубликованный email, в Telegram, по телефону или по адресу продавца. Для быстрой обработки укажите номер и дату заказа, опишите проблему и желаемое решение; при необходимости приложите фото. Претензии обрабатывает менеджер продавца. Фискальный чек не является единственным допустимым доказательством покупки."] },
        { id: "deadlines", title: "2. Подтверждение и сроки", bullets: ["Продавец без задержки подтверждает получение и сообщает регистрационный номер претензии.", "Письменный или электронный ответ направляется не позднее восьми дней с момента получения.", "Принятая претензия решается в согласованный срок, но для этой категории товаров не позднее установленного законом срока в 15 дней.", "Реестр претензий хранится не менее двух лет."] },
        { id: "remedies", title: "3. Варианты решения", paragraphs: ["С учётом обстоятельств и предусмотренного законом выбора покупателя решением может быть доставка надлежащего товара, уменьшение цены или полный возврат. Для приготовленной еды замена предлагается только когда это безопасно и разумно для покупателя."] },
        { id: "refund", title: "4. Способ возврата", bullets: ["При наличной оплате способ возврата согласуется с покупателем.", "При оплате картой возврат проводится на ту же карту через платёжного провайдера и не выдаётся наличными.", "Продавец сообщает о запуске возврата; дальнейший срок зачисления зависит от провайдера и банка-эмитента.", "Двойное списание, подтверждённая оплата без созданного заказа или отменённый оплаченный заказ проверяются у провайдера и при подтверждении списания возвращаются полностью."] },
        { id: "chargeback", title: "5. Несанкционированная операция и chargeback", paragraphs: ["О подозрительной карточной операции следует сразу сообщить банку-эмитенту и продавцу. Процедуру chargeback ведёт банк по правилам карточной системы; она не лишает покупателя права сначала обратиться к продавцу."] },
      ],
    },
    privacy: {
      title: "Политика конфиденциальности",
      intro: "Здесь описано, какие данные обрабатываются при использовании Tako Lako, зачем они нужны, кому передаются и какие права есть у пользователя.",
      sections: [
        { id: "data", title: "1. Какие данные обрабатываются", bullets: ["Telegram ID и публичные данные профиля для входа и связи заказа с покупателем.", "Подтверждённый телефон, текстовый адрес, комментарий, язык и история заказов.", "Состав и суммы заказов, статус доставки, способ и статус оплаты, претензии и переписка с поддержкой.", "Технические данные безопасности и работы сервиса: время запроса, IP-адрес и события безопасности. Telegram initData проверяется сервером и не записывается в логи.", "Для геопроверки наличного заказа точные координаты не хранятся; сохраняются только результат, расстояние, точность, время и причина отказа.", "Данные использования приложения: открытые экраны и нажатия на кнопки или ссылки. Содержимое полей, телефон, адрес, координаты и Telegram initData в события аналитики не попадают."] },
        { id: "purpose", title: "2. Цели и правовые основания", bullets: ["Исполнение договора: расчёт, принятие, приготовление, доставка, поддержка и возврат.", "Юридическая обязанность: фискальные и бухгалтерские документы, претензии и ответы госорганам.", "Законный интерес: предотвращение злоупотреблений, безопасность, доказательство операции, улучшение удобства приложения и разрешение споров с учётом прав покупателя."] },
        { id: "sharing", title: "3. Получатели данных", paragraphs: ["Данные получают только те, кому они необходимы: уполномоченные сотрудники продавца, единственный курьер для конкретной доставки, договорные хостинг- и IT-подрядчики, платёжный провайдер и банк при онлайн-оплате, а также госорганы по закону. Курьер видит только необходимое для доставки."], bullets: ["Данные карты вводятся у платёжного провайдера и не проходят через сервер Tako Lako.", "Telegram обрабатывает данные своей платформы по собственной политике; Tako Lako не контролирует аккаунт и инфраструктуру Telegram.", "Данные не продаются и не используются для таргетированной рекламы."] },
        { id: "retention", title: "4. Хранение и безопасность", paragraphs: ["Данные хранятся только необходимый срок: деловая и фискальная документация — в установленные законом сроки, реестр претензий — не менее двух лет, события продуктовой аналитики — не более 400 дней, данные безопасности — ограниченное время для защиты системы и расследования инцидента. После этого данные удаляются или обезличиваются, если нет иного законного основания."], bullets: ["Телефон и адрес зашифрованы, доступ ограничен ролью сотрудника, чувствительные данные не записываются в журналы приложения.", "Локальная корзина содержит только ID товаров, отображаемые данные и количество; в ней нет телефона, адреса, сессии или Telegram initData."] },
        { id: "rights", title: "5. Права пользователя", paragraphs: ["Пользователь может запросить доступ, исправление, удаление или ограничение обработки, возразить против обработки на основании законного интереса и запросить переносимость в предусмотренных законом случаях. Запрос направляется на опубликованный email; до ответа может потребоваться разумная проверка личности."], bullets: ["Нельзя удалить данные, которые продавец обязан продолжать хранить по фискальным, бухгалтерским, потребительским или судебным требованиям.", "Жалобу можно подать Уполномоченному по информации общественного значения и защите персональных данных: poverenik.rs."] },
      ],
    },
  },
  en: {
    updated: "Effective date: 27 August 2026 · version 2026-08-27",
    nav: { terms: "Terms of sale", returns: "Complaints and refunds", privacy: "Privacy" },
    merchantTitle: "Merchant details",
    merchantIntro: "Tako Lako is the name of the sales outlet. The contracting party and personal-data controller is the entrepreneur identified below.",
    missingTitle: "Mandatory merchant details have not been published",
    missingBody: "Before card payments are enabled, the full APR-registered business name, registration number, PIB, address, email and phone must be supplied. Until then, this document is a draft and is not ready for bank or acquirer review.",
    notProvided: "not supplied",
    fields: {
      businessName: "Registered business name",
      registrationNumber: "Registration number",
      taxID: "PIB (tax ID)",
      vatStatus: "VAT status",
      registeredAddress: "Registered address",
      restaurantAddress: "Restaurant address",
      email: "Contact and complaints email",
      phone: "Phone",
      registry: "Registry",
      support: "Telegram support",
    },
    terms: {
      title: "Terms of sale and delivery",
      intro: "These terms govern ordering, payment and food delivery through the Tako Lako Telegram Mini App. A customer may save or print them before placing an order.",
      sections: [
        { id: "scope", title: "1. Merchant and scope", paragraphs: ["The merchant prepares and delivers food in Novi Sad where delivery is available at the time of ordering. These terms apply to consumers ordering through the Tako Lako application.", "The version displayed immediately before the order is submitted applies to that order. Mandatory laws of the Republic of Serbia prevail over these terms."] },
        { id: "order", title: "2. Contract and order confirmation", bullets: ["The customer selects products and quantities, provides a phone number and address, selects an offered payment method and reviews the final order summary.", "Prices, delivery charge, total, payment method and delivery details are shown before the order button.", "An order is accepted when the application displays its number and accepted status. For online payment, this happens only after server-side payment confirmation.", "If an item is unavailable or delivery is objectively impossible, the merchant promptly offers an amendment or cancellation; any confirmed charge is refunded in full."] },
        { id: "prices", title: "3. Prices and delivery", paragraphs: ["All prices are final consumer prices in Serbian dinars (RSD). The merchant is not in the Serbian VAT system. Delivery is free and there is no minimum order value. An accepted price is not changed without the customer's explicit agreement.", "The customer is responsible for an accurate phone number and address. Delivery takes place during the published working hours. The indicative delivery time is 5 to 60 minutes after the food is prepared, depending on the address, workload and traffic. If that timing is not possible, the merchant contacts the customer to agree a new time or cancel without cost to the customer."] },
        { id: "payment", title: "4. Payment methods and security", bullets: ["Only payment methods shown at checkout are available. Until cards are activated, real orders are paid in cash on delivery.", "Once cards are enabled, card details are entered only on the contracted payment provider's secure hosted page. Tako Lako does not receive or store the card number, expiry date or CVV/CVC.", "A card order is paid only after server-side confirmation from the payment provider. A browser success page is not proof of payment by itself.", "Payments are charged in RSD. The card issuer may apply conversion or its own fee where the customer's account uses another currency."] },
        { id: "receipt", title: "5. Fiscal receipt", paragraphs: ["The merchant records the sale and issues a fiscal receipt under Serbian law. The customer receives it with the delivery or electronically when the legal requirements for electronic delivery are met."] },
        { id: "food", title: "6. Food information and allergens", paragraphs: ["Images are illustrative. Minor visual differences do not make food non-conforming where its composition and the ordered product match the description. Available composition, quantity and allergen information is shown with the product or provided by support before ordering.", "A free-text order comment does not guarantee removal of an allergen. Customers with allergies should contact support before ordering to confirm whether safe preparation is possible."] },
        { id: "cancellation", title: "7. Cancellation and withdrawal", paragraphs: ["After an order is accepted, the customer cannot unilaterally cancel it because food preparation may begin immediately. If the customer contacts support before preparation starts, the merchant may exceptionally confirm cancellation; without that confirmation, the order remains active.", "The statutory 14-day distance-contract withdrawal right does not apply to goods liable to deteriorate or expire rapidly, or goods made to the consumer's specifications. This does not limit rights where food is wrong, unsafe, non-conforming or not delivered."] },
        { id: "complaints", title: "8. Complaints, refunds and disputes", paragraphs: ["The complaint process, deadlines and refund method are detailed on the separate “Complaints and refunds” page, which forms part of these terms.", "If a dispute is not resolved directly, the consumer may seek out-of-court consumer dispute resolution. The merchant participates when required by law. Serbian law applies and jurisdiction is determined by mandatory law."] },
        { id: "contact", title: "9. Contact and amendments", paragraphs: ["Questions about an order, these terms or personal data may be sent to the published email, phone or Telegram support. Amendments apply only to future orders and are published with a new date and version."] },
      ],
    },
    returns: {
      title: "Complaints, cancellation and refunds",
      intro: "This policy explains how to report a food, delivery or payment problem and how refunds are handled.",
      sections: [
        { id: "submit", title: "1. Submitting a complaint", paragraphs: ["A complaint may be submitted by published email, Telegram support, phone or at the merchant's address. For faster handling, include the order number and date, a description, the requested remedy and, where useful, a photo. Complaints are handled by the merchant's manager. A fiscal receipt is not the only acceptable proof of purchase."] },
        { id: "deadlines", title: "2. Acknowledgement and deadlines", bullets: ["The merchant acknowledges the complaint without delay and provides a reference number.", "A written or electronic response is provided no later than eight days after receipt.", "An accepted complaint is resolved within the agreed period, no longer than the statutory 15-day period for this category of goods.", "Complaint records are retained for at least two years."] },
        { id: "remedies", title: "3. Remedies", paragraphs: ["Depending on the circumstances and the consumer's statutory choice, the remedy may be delivery of conforming goods, a price reduction or a full refund. Because the goods are prepared food, replacement is offered only where safe and meaningful for the customer."] },
        { id: "refund", title: "4. Refund method", bullets: ["For cash payments, the refund method is agreed with the customer.", "For card payments, the refund is initiated to the same card through the payment provider and is not paid in cash.", "The merchant confirms when the refund is initiated. The time to credit the account then depends on the payment provider and card issuer.", "A duplicate charge, confirmed payment without an order, or cancelled paid order is checked with the payment provider and refunded in full once the charge is confirmed."] },
        { id: "chargeback", title: "5. Unauthorised transactions and chargebacks", paragraphs: ["A suspected unauthorised card transaction should be reported immediately to the card issuer and the merchant. The issuer runs any chargeback under card-scheme rules; this does not remove the customer's right to contact the merchant first."] },
      ],
    },
    privacy: {
      title: "Privacy notice",
      intro: "This notice describes the personal data processed when you use Tako Lako, why it is used, who receives it and your rights.",
      sections: [
        { id: "data", title: "1. Data we process", bullets: ["Telegram identifier and public profile data needed for authentication and linking an order to the customer.", "Verified phone number, text address, comment, language and order history.", "Order contents and values, delivery status, selected payment method and status, complaints and support messages.", "Technical data needed for security and operation, such as request time, IP address and security events. Telegram initData is verified by the server and is not written to application logs.", "For cash-order location verification, exact coordinates are not retained; only the result, distance, accuracy, time and rejection reason are stored.", "Application usage data: screens opened and buttons or links clicked. Field contents, phone numbers, addresses, coordinates and Telegram initData are not included in analytics events."] },
        { id: "purpose", title: "2. Purposes and legal bases", bullets: ["Contract performance: calculation, acceptance, preparation, delivery, support and refunds.", "Legal obligations: fiscal and accounting records, complaint records and responses to competent authorities.", "Legitimate interests: abuse prevention, service security, transaction evidence, usability improvement and dispute resolution, balanced against customer rights."] },
        { id: "sharing", title: "3. Recipients", paragraphs: ["Data is disclosed only where needed: authorised merchant staff, the single courier for the relevant delivery, contracted hosting and IT suppliers, the payment provider and bank for online payment, and public authorities where required by law. The courier sees only what is needed to complete delivery."], bullets: ["Card details are entered with the payment provider and do not pass through the Tako Lako server.", "Telegram processes data within its platform under its own privacy terms. Tako Lako does not control a customer's Telegram account or Telegram infrastructure.", "Personal data is not sold or used for targeted advertising."] },
        { id: "retention", title: "4. Retention and security", paragraphs: ["Data is kept only as long as needed: business and fiscal records for statutory periods, complaint records for at least two years, product analytics events for no more than 400 days, and security data for a limited period needed to protect the service and investigate incidents. Data is then deleted or anonymised unless another legal basis requires retention."], bullets: ["Phone numbers and addresses are encrypted, staff access is role-limited, and sensitive values are not written to application logs.", "The cart stored on the device contains product IDs, display data and quantities only; it contains no phone, address, session or Telegram initData."] },
        { id: "rights", title: "5. Your rights", paragraphs: ["You may request access, correction, deletion or restriction, object where processing relies on legitimate interests, and request portability where the statutory conditions are met. Send a request to the published email. A reasonable identity check may be required before responding."], bullets: ["Deletion does not apply to records the merchant must retain for fiscal, accounting, consumer-protection or legal-claim purposes.", "A complaint may be made to the Commissioner for Information of Public Importance and Personal Data Protection: poverenik.rs."] },
      ],
    },
  },
};

export function isPublicInformationRoute(route: Route): boolean {
  return route.name === "terms" || route.name === "returns" || route.name === "privacy" || route.name === "support";
}

export function Terms({ locale }: { locale: Locale }) {
  return <LegalDocumentPage locale={locale} document="terms" />;
}

export function Returns({ locale }: { locale: Locale }) {
  return <LegalDocumentPage locale={locale} document="returns" />;
}

export function Privacy({ locale }: { locale: Locale }) {
  return <LegalDocumentPage locale={locale} document="privacy" />;
}

export function legalContactText(locale: Locale): { title: string; intro: string; emailLabel: string; telegramLabel: string; missingEmail: string } {
  if (locale === "sr") return {
    title: "Podrška i kontakt",
    intro: "Za pitanje o porudžbini, reklamaciju, otkazivanje ili zahtev u vezi sa ličnim podacima kontaktirajte prodavca.",
    emailLabel: "E-mail",
    telegramLabel: "Telegram podrška",
    missingEmail: "E-mail mora biti unet pre aktivacije kartičnog plaćanja.",
  };
  if (locale === "en") return {
    title: "Support and contact",
    intro: "Contact the merchant about an order, complaint, cancellation or personal-data request.",
    emailLabel: "Email",
    telegramLabel: "Telegram support",
    missingEmail: "An email address must be supplied before card payments are enabled.",
  };
  return {
    title: "Поддержка и контакты",
    intro: "По вопросам заказа, претензии, отмены или персональных данных свяжитесь с продавцом.",
    emailLabel: "Email",
    telegramLabel: "Поддержка в Telegram",
    missingEmail: "Email нужно указать до подключения оплаты картой.",
  };
}

function LegalDocumentPage({ locale, document }: { locale: Locale; document: "terms" | "returns" | "privacy" }) {
  const copy = legalCopy[locale];
  const content = copy[document];
  const showMerchant = document === "terms" || document === "privacy";

  return (
    <article className="page narrow legal-page">
      <header className="legal-hero">
        <span className="eyebrow">Tako Lako</span>
        <h1>{content.title}</h1>
        <p className="lead">{content.intro}</p>
        <small>{copy.updated}</small>
      </header>
      <LegalNav copy={copy} active={document} />
      {showMerchant && <MerchantDetails copy={copy} />}
      <div className="legal-sections">
        {content.sections.map((section) => (
          <section id={section.id} className="legal-section" key={section.id}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.bullets && (
              <ul>
                {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
      <LegalNav copy={copy} active={document} />
    </article>
  );
}

function MerchantDetails({ copy }: { copy: LegalCopy }) {
  const requiredMissing = [
    legalProfile.businessName,
    legalProfile.registrationNumber,
    legalProfile.taxID,
    legalProfile.vatStatus,
    legalProfile.registeredAddress,
    legalProfile.email,
    legalProfile.phone,
  ].some((value) => !value);
  const rows = [
    [copy.fields.businessName, legalProfile.businessName],
    [copy.fields.registrationNumber, legalProfile.registrationNumber],
    [copy.fields.taxID, legalProfile.taxID],
    [copy.fields.vatStatus, legalProfile.vatStatus],
    [copy.fields.registeredAddress, legalProfile.registeredAddress],
    [copy.fields.restaurantAddress, legalProfile.restaurantAddress],
    [copy.fields.email, legalProfile.email],
    [copy.fields.phone, legalProfile.phone],
    [copy.fields.registry, "Agencija za privredne registre Republike Srbije (APR)"],
    [copy.fields.support, legalProfile.supportTelegram],
  ];

  return (
    <section className="merchant-card" aria-labelledby="merchant-details-title">
      <h2 id="merchant-details-title">{copy.merchantTitle}</h2>
      <p>{copy.merchantIntro}</p>
      {requiredMissing && (
        <div className="legal-warning" role="note">
          <strong>{copy.missingTitle}</strong>
          <p>{copy.missingBody}</p>
        </div>
      )}
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value ? undefined : "missing-value"}>{value || copy.notProvided}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LegalNav({ copy, active }: { copy: LegalCopy; active: "terms" | "returns" | "privacy" }) {
  return (
    <nav className="legal-nav" aria-label="Legal information">
      <a className={active === "terms" ? "active" : ""} href="#/terms">{copy.nav.terms}</a>
      <a className={active === "returns" ? "active" : ""} href="#/returns">{copy.nav.returns}</a>
      <a className={active === "privacy" ? "active" : ""} href="#/privacy">{copy.nav.privacy}</a>
    </nav>
  );
}

function publicValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export { termsVersion };
