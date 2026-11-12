from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from ..models import Dish, UserProfile


# Only explicit, high-confidence synonyms are normalized. Unknown ingredients
# remain searchable under their own normalized spelling.
_ALIAS_GROUPS = (
    ("thịt heo", "thịt lợn"),
    ("đậu phụ", "đậu hũ"),
    ("dưa chuột", "dưa leo"),
    ("đậu phộng", "lạc", "lạc hạt", "peanut", "groundnut"),
    ("bắp cải", "cải bắp"),
    ("bột ngọt", "mì chính"),
)
_ALIAS_TO_CANONICAL = {}


def _fold(value: str) -> str:
    value = unicodedata.normalize("NFC", value.casefold())
    return re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).strip()


for _group in _ALIAS_GROUPS:
    _canonical = _fold(_group[0])
    for _alias in _group:
        _ALIAS_TO_CANONICAL[_fold(_alias)] = _canonical


def normalize_ingredient(value: str) -> str:
    """Case/accent/punctuation normalization with conservative synonyms."""
    folded = _fold(value)
    return _ALIAS_TO_CANONICAL.get(folded, folded)


@dataclass(frozen=True)
class IngredientPart:
    display: str
    match_keys: frozenset[str]
    vector_terms: frozenset[str]


_QUANTITY = re.compile(
    r"\s*:\s*\d+(?:[.,]\d+)?\s*(?:g|gr|kg|ml|l|gam|quả|củ|nhánh|thìa|muỗng|con|miếng|lá|lát|bó)?\s*$",
    re.IGNORECASE,
)
_PAREN_CONTENT = re.compile(r"\(([^()]*)\)")


def parse_ingredients(value: str | None) -> list[IngredientPart]:
    if not value or not value.strip():
        return []
    output: list[IngredientPart] = []
    seen: set[str] = set()
    for raw in re.split(r"[|;\n]+", value):
        cleaned = _QUANTITY.sub("", raw).strip(" \t,.;:-")
        if not cleaned:
            continue
        alternatives = [part.strip() for part in cleaned.split("/") if part.strip()]
        keys: set[str] = set()
        terms: set[str] = set()
        for alternative in alternatives or [cleaned]:
            forms = [alternative, _PAREN_CONTENT.sub(" ", alternative)]
            forms.extend(_PAREN_CONTENT.findall(alternative))
            for form in forms:
                normalized = normalize_ingredient(form)
                if not normalized:
                    continue
                keys.add(normalized)
                # Encode phrases as one token (e.g. "thịt bò" -> "thit_bo")
                # so TF-IDF does not match every dish containing the word "thịt".
                terms.add(normalized.replace(" ", "_"))
        if not keys:
            continue
        signature = sorted(keys)[0]
        if signature in seen:
            continue
        seen.add(signature)
        output.append(IngredientPart(cleaned, frozenset(keys), frozenset(terms)))
    return output


def _phrase_matches(query: str, ingredient: IngredientPart) -> bool:
    for key in ingredient.match_keys:
        if query == key or (len(query.split()) > 1 and key.startswith(query + " ")):
            return True
    return False


def _profile_terms(profile: UserProfile | None) -> list[str]:
    if profile is None:
        return []
    import json

    values: list[str] = []
    for field in ("allergies_json", "avoid_ingredients_json"):
        try:
            entries = json.loads(getattr(profile, field) or "[]")
        except (TypeError, ValueError):
            continue
        values.extend(normalize_ingredient(str(item)) for item in entries if str(item).strip())
    return values


def dish_is_avoided(dish: Dish, profile: UserProfile | None) -> bool:
    """Conservative profile safety filter shared by search and manual selection."""
    terms = _profile_terms(profile)
    if not terms:
        return False
    parts = parse_ingredients(dish.ingredients)
    if not parts:
        # Unknown ingredients cannot be cleared against an avoidance list.
        return True
    return any(_phrase_matches(term, part) for term in terms for part in parts)


class IngredientRecommender:
    """In-memory TF-IDF index built once from the loaded dish catalog."""

    SCORE_WEIGHTS = {"cosine_similarity": 0.50, "ingredient_match_ratio": 0.40, "goal_preference": 0.10}
    LABEL_BY_GOAL = {
        "lose_weight": "Giảm cân",
        "gain_weight": "Tăng cân",
        "gain_muscle": "Tăng cơ",
        "maintain_weight": "Duy trì",
    }
    LABEL_NOTE = "Nhãn lấy từ file gán nhãn AI theo quy tắc; chỉ là thông tin tham khảo, không phải đánh giá chuyên gia."

    def __init__(self, dishes: Iterable[Dish]):
        self.dishes = [dish for dish in dishes if dish.ingredients and parse_ingredients(dish.ingredients)]
        self.parts = [parse_ingredients(dish.ingredients) for dish in self.dishes]
        documents = [
            " ".join(sorted({term for part in parts for term in part.vector_terms}))
            for parts in self.parts
        ]
        self.vectorizer = TfidfVectorizer(
            tokenizer=str.split,
            preprocessor=None,
            token_pattern=None,
            lowercase=False,
            norm="l2",
        )
        self.matrix = self.vectorizer.fit_transform(documents) if documents else None

    def suggest_ingredients(self, query: str, *, limit: int = 30) -> list[str]:
        """Return catalog ingredient names that begin with the user's category/query."""
        normalized = normalize_ingredient(query)
        if not normalized:
            return []
        matches = {
            part.display
            for parts in self.parts
            for part in parts
            if any(key == normalized or key.startswith(normalized + " ") for key in part.match_keys)
        }
        return sorted(matches, key=lambda value: (normalize_ingredient(value), value))[:limit]

    def search(
        self,
        ingredients: list[str],
        *,
        limit: int = 12,
        max_calories: float | None = None,
        min_protein: float | None = None,
        goal: str | None = None,
        profile: UserProfile | None = None,
    ) -> dict:
        normalized_inputs: list[str] = []
        seen_inputs: set[str] = set()
        for value in ingredients:
            normalized = normalize_ingredient(value)
            if normalized and normalized not in seen_inputs:
                normalized_inputs.append(normalized)
                seen_inputs.add(normalized)
        if not normalized_inputs:
            return {"ingredients": [], "total": 0, "results": [], "warnings": ["Không nhận diện được nguyên liệu nhập vào."]}

        if self.matrix is None:
            return {"ingredients": normalized_inputs, "total": 0, "results": [], "warnings": ["Catalog chưa có nguyên liệu để tìm kiếm."]}

        query_document = " ".join(sorted({item.replace(" ", "_") for item in normalized_inputs}))
        query_vector = self.vectorizer.transform([query_document])
        similarities = cosine_similarity(query_vector, self.matrix).ravel()
        allergy_terms = _profile_terms(profile)
        goal_label = self.LABEL_BY_GOAL.get(goal or "")
        candidates: list[dict] = []
        excluded_data_quality = False

        for dish, parts, similarity in zip(self.dishes, self.parts, similarities):
            if similarity <= 0:
                continue
            if dish.kcal_macro_mismatch or (
                dish.calories_per_100g is not None
                and (dish.calories_per_100g < 0 or dish.calories_per_100g > 900)
            ):
                excluded_data_quality = True
                continue
            if allergy_terms and (
                not parts
                or any(_phrase_matches(term, part) for term in allergy_terms for part in parts)
            ):
                continue

            calories = dish.calories_per_serving
            protein = dish.protein_per_serving
            if max_calories is not None and (calories is None or calories > max_calories):
                continue
            if min_protein is not None and (protein is None or protein < min_protein):
                continue

            matched_parts = [part for part in parts if any(_phrase_matches(term, part) for term in normalized_inputs)]
            missing_parts = [part for part in parts if part not in matched_parts]
            required_count = len(parts)
            matched_count = len(matched_parts)
            ratio = matched_count / required_count if required_count else 0.0
            goal_preference = 1.0 if goal_label and dish.nutrition_label == goal_label else 0.5
            score = (
                self.SCORE_WEIGHTS["cosine_similarity"] * float(similarity)
                + self.SCORE_WEIGHTS["ingredient_match_ratio"] * ratio
                + self.SCORE_WEIGHTS["goal_preference"] * goal_preference
            )
            candidates.append({
                "dish_id": dish.id,
                "name": dish.name,
                "image_url": dish.image_url,
                "ingredients": [part.display for part in parts],
                "matched_ingredients": [part.display for part in matched_parts],
                "missing_ingredients": [part.display for part in missing_parts],
                "matched_count": matched_count,
                "required_count": required_count,
                "ingredient_match_ratio": round(ratio, 4),
                "similarity_score": round(float(similarity), 4),
                "calories": calories,
                "protein": protein,
                "carb": dish.carb_per_serving,
                "fat": dish.fat_per_serving,
                "serving_grams": dish.serving_g,
                "instructions": dish.instructions,
                "food_group": dish.food_group,
                "nutrition_label": dish.nutrition_label,
                "nutrition_label_note": self.LABEL_NOTE if dish.nutrition_label else None,
                "_score": score,
            })

        candidates.sort(
            key=lambda item: (
                item["_score"], item["matched_count"], -len(item["missing_ingredients"]),
                item["similarity_score"], item["dish_id"],
            ),
            reverse=True,
        )
        results = [{key: value for key, value in row.items() if key != "_score"} for row in candidates[:limit]]
        warnings = [
            "Độ tương đồng cosine đo mức gần nhau của nguyên liệu, không chứng minh món có thể nấu đầy đủ với nguyên liệu hiện có.",
            "Dữ liệu không tách riêng gia vị/nguyên liệu chính; mọi thành phần trong công thức đều được tính vào tỷ lệ và phần còn thiếu.",
            "Dữ liệu thành phần có thể chưa đầy đủ; nếu có dị ứng, hãy kiểm tra công thức và nguồn món trước khi sử dụng.",
        ]
        if goal_label and not any(dish.nutrition_label for dish in self.dishes):
            warnings.append("Catalog không có nhãn dinh dưỡng; mục tiêu không được dùng để xếp hạng kết quả.")
        if excluded_data_quality:
            warnings.append("Một số món trùng truy vấn bị loại do cờ dinh dưỡng bất thường trong catalog.")
        return {"ingredients": normalized_inputs, "total": len(candidates), "results": results, "warnings": warnings}
